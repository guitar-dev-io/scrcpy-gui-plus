package com.scrcpyguiplus.companion

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.hardware.usb.UsbAccessory
import android.hardware.usb.UsbManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import java.util.ArrayDeque
import java.util.Locale
import kotlin.math.roundToInt
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var usbManager: UsbManager
    private lateinit var statusView: TextView
    private lateinit var logView: TextView
    private lateinit var pairingInput: EditText
    private lateinit var remoteStatusView: TextView
    private val remoteButtons = mutableListOf<Button>()
    private lateinit var remoteVideoView: SurfaceView
    private lateinit var remoteTextInput: EditText
    private lateinit var remoteTextButton: Button
    private lateinit var remoteClipboardButton: Button
    private val pairingPreferences by lazy {
        getSharedPreferences(PAIRING_PREFERENCES, Context.MODE_PRIVATE)
    }
    private var savedLanOffer: LanPairingOffer? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val logs = ArrayDeque<String>()
    private val permissionAction by lazy { "$packageName.USB_PERMISSION" }
    private val protocolProcessor by lazy(LazyThreadSafetyMode.NONE) {
        ProtocolProcessor(
            requestHandler = ::dispatchRequest,
            eventLogger = ::appendLog,
        )
    }
    private var permissionAccessory: UsbAccessory? = null
    private var pendingAccessory: UsbAccessory? = null
    private var receiverRegistered = false
    private var activityStarted = false
    private var connectionGeneration = 0
    private var connection: CompanionSession? = null
    private var remoteSession: RemoteControlSession? = null
    private var remoteVideoSession: RemoteVideoSession? = null
    private var remoteVideoRenderer: RemoteVideoRenderer? = null
    private var remoteVideoWidth = 0
    private var remoteVideoHeight = 0
    private var remoteTouchInFlight = false
    private var pendingRemoteTouch: JSONObject? = null
    private var lastRemoteMoveAt = 0L
    private var pendingScreenOffer: ScreenStreamOffer? = null
    private var awaitingScreenPermission = false
    private var screenCaptureGeneration = 0L
    /** True while the MediaProjection foreground service is expected to own the capture. */
    private var screenCaptureServiceStarted = false
    private val clipboardManager by lazy {
        getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }
    private val barcodeScanner by lazy {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build()
        GmsBarcodeScanning.getClient(this, options)
    }

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                permissionAction -> handlePermissionResult(intent)
                UsbManager.ACTION_USB_ACCESSORY_DETACHED -> handleAccessoryDetached(intent)
                ScreenCaptureService.ACTION_STATUS -> handleScreenCaptureStatus(intent)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager
        setContentView(createContentView())
        val persistedLanOffer = loadSavedLanOffer()
        val sameProcessRecreation =
            savedInstanceState?.getString(STATE_PROCESS_INSTANCE_ID) == PROCESS_INSTANCE_ID
        if (ScreenCaptureService.isRunning() || sameProcessRecreation) {
            // Persisted LAN credentials are only valid for recovering an active foreground
            // capture or a same-process Activity recreation. A normal launch must require a
            // fresh offer because its port and token belong to the desktop listener that made it.
            savedLanOffer = persistedLanOffer
            if (persistedLanOffer != null) {
                appendLog("Restored LAN pairing for the current app session")
            }
        } else if (persistedLanOffer != null) {
            clearSavedLanOffer()
            appendLog("Discarded a stale LAN pairing offer from an earlier session")
        }
        registerUsbReceiver()
        handleAccessoryIntent(intent)
        appendLog("Activity ready; choose QR / LAN or USB accessory")
    }

    override fun onStart() {
        super.onStart()
        activityStarted = true
        if (ScreenCaptureService.isRunning()) {
            screenCaptureServiceStarted = true
        } else if (screenCaptureServiceStarted) {
            // The service may have failed after startForegroundService returned. Do not keep
            // treating a dead capture as a reason to preserve the Activity connection forever.
            screenCaptureServiceStarted = false
            screenCaptureGeneration = 0L
            updateStatus("Screen sharing is no longer running")
        }
        if (awaitingScreenPermission) return

        val serviceActive = screenCaptureServiceStarted || ScreenCaptureService.isRunning()
        if (serviceActive) {
            updateStatus("Screen sharing continues in the background")
            // Activity recreation must not require a second QR scan while the foreground service
            // still owns MediaProjection and the persisted LAN offer remains valid.
            if (connection == null) savedLanOffer?.let(::connectToLan)
            return
        }

        val launchAccessory = pendingAccessory
        pendingAccessory = null
        when {
            launchAccessory != null -> connectToAccessory(launchAccessory)
            savedLanOffer != null -> connectToLan(savedLanOffer!!)
            else -> discoverAccessory()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(STATE_PROCESS_INSTANCE_ID, PROCESS_INSTANCE_ID)
        super.onSaveInstanceState(outState)
    }

    override fun onStop() {
        activityStarted = false
        // Controller actions are intentionally foreground-only. ScreenCaptureService may keep
        // the legacy reverse stream alive, but it must not retain this separate command socket.
        stopRemoteControlLocal("Activity left the foreground")
        if (awaitingScreenPermission) {
            updateStatus("Waiting for the Android screen-capture permission dialog")
            super.onStop()
            return
        }
        if (screenCaptureServiceStarted || ScreenCaptureService.isRunning()) {
            // The foreground service owns MediaProjection and the active LAN stream. Do not
            // tear down either socket just because the Activity is no longer visible.
            updateStatus("Screen sharing continues in the background")
            super.onStop()
            return
        }
        stopScreenCapture("Activity left the foreground")
        disconnectConnection("Activity left the foreground")
        updateStatus("Paused; reopen the app to reconnect")
        super.onStop()
    }

    override fun onDestroy() {
        stopRemoteControlLocal("Activity destroyed")
        if (screenCaptureServiceStarted || ScreenCaptureService.isRunning()) {
            // Home/app switching normally does not destroy the Activity, but keeping this guard
            // prevents an Activity recreation from stopping an active foreground capture.
            appendLog("Activity destroyed; keeping the screen capture service running")
        } else {
            stopScreenCapture("Activity destroyed")
            disconnectConnection("Activity destroyed")
        }
        if (receiverRegistered) {
            unregisterReceiver(usbReceiver)
            receiverRegistered = false
        }
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAccessoryIntent(intent)
    }

    private fun createContentView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp(), 24.dp(), 20.dp(), 20.dp())
            setBackgroundColor(Color.WHITE)
        }

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 24f
            setTextColor(Color.rgb(20, 20, 20))
            setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        }
        root.addView(title, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val instructions = TextView(this).apply {
            text = getString(R.string.keep_open_message)
            textSize = 14f
            setTextColor(Color.DKGRAY)
            setPadding(0, 8.dp(), 0, 8.dp())
        }
        root.addView(instructions, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val aoaGuidance = TextView(this).apply {
            text = getString(R.string.aoa_permission_guidance)
            textSize = 13f
            setTextColor(Color.DKGRAY)
            setPadding(0, 0, 0, 16.dp())
        }
        root.addView(aoaGuidance, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val lanGuidance = TextView(this).apply {
            text = getString(R.string.lan_pairing_guidance)
            textSize = 13f
            setTextColor(Color.DKGRAY)
            setPadding(0, 0, 0, 8.dp())
        }
        root.addView(lanGuidance, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val scanQrButton = Button(this).apply {
            text = getString(R.string.scan_desktop_qr)
            setOnClickListener { startQrScan() }
        }
        root.addView(scanQrButton, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        pairingInput = EditText(this).apply {
            hint = getString(R.string.manual_pairing_hint)
            maxLines = 3
            setTextSize(12f)
            setTextIsSelectable(true)
        }
        root.addView(pairingInput, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val connectCodeButton = Button(this).apply {
            text = getString(R.string.connect_pairing_code)
            setOnClickListener { connectToLanPayload(pairingInput.text.toString()) }
        }
        root.addView(connectCodeButton, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val statusCaption = TextView(this).apply {
            text = getString(R.string.connection_status)
            textSize = 13f
            setTextColor(Color.GRAY)
        }
        root.addView(statusCaption, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        statusView = TextView(this).apply {
            text = getString(R.string.starting)
            textSize = 18f
            setTextColor(Color.rgb(21, 101, 192))
            setPadding(0, 4.dp(), 0, 12.dp())
        }
        root.addView(statusView, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val checkButton = Button(this).apply {
            text = getString(R.string.check_accessory)
            setOnClickListener { discoverAccessory() }
        }
        root.addView(checkButton, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        root.addView(createRemoteControlCard())

        val logsCaption = TextView(this).apply {
            text = getString(R.string.latest_logs)
            textSize = 13f
            setTextColor(Color.GRAY)
            setPadding(0, 16.dp(), 0, 4.dp())
        }
        root.addView(logsCaption, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        logView = TextView(this).apply {
            text = getString(R.string.no_events_yet)
            textSize = 13f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.DKGRAY)
            gravity = Gravity.TOP or Gravity.START
            setTextIsSelectable(true)
        }
        root.addView(
            logView,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                240.dp(),
            ),
        )
        return ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
    }

    private fun createRemoteControlCard(): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12.dp(), 12.dp(), 12.dp(), 12.dp())
            setBackgroundColor(Color.rgb(238, 242, 247))
        }
        card.addView(TextView(this).apply {
            text = getString(R.string.remote_control_title)
            textSize = 16f
            setTextColor(Color.rgb(20, 20, 20))
            setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        })
        remoteStatusView = TextView(this).apply {
            text = getString(R.string.remote_control_waiting)
            textSize = 13f
            setTextColor(Color.DKGRAY)
            setPadding(0, 4.dp(), 0, 8.dp())
        }
        card.addView(remoteStatusView)

        remoteVideoView = SurfaceView(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            isFocusable = true
            isFocusableInTouchMode = true
            setOnTouchListener { _, event -> handleRemoteTouch(event) }
            setOnKeyListener { _, keyCode, event -> handleRemoteKey(keyCode, event) }
        }
        card.addView(
            remoteVideoView,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 280.dp()),
        )

        val actions = listOf(
            getString(R.string.remote_back) to "back",
            getString(R.string.remote_home) to "home",
            getString(R.string.remote_recents) to "recents",
            getString(R.string.remote_rotate) to "rotate",
            getString(R.string.remote_screen_on) to "screen_on",
            getString(R.string.remote_screen_off) to "screen_off",
        )
        actions.chunked(3).forEach { rowActions ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowActions.forEach { (label, method) ->
                val button = Button(this).apply {
                    text = label
                    isEnabled = false
                    setOnClickListener { sendRemoteAction(method) }
                }
                remoteButtons += button
                row.addView(button, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            }
            card.addView(row, LinearLayout.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val textRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
        }
        remoteTextInput = EditText(this).apply {
            hint = getString(R.string.remote_text_hint)
            maxLines = 2
        }
        textRow.addView(
            remoteTextInput,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        remoteTextButton = Button(this).apply {
            text = getString(R.string.remote_send_text)
            setOnClickListener { sendRemoteText() }
        }
        textRow.addView(remoteTextButton)
        card.addView(textRow)
        remoteTextInput.tag = textRow

        remoteClipboardButton = Button(this).apply {
            text = getString(R.string.remote_send_clipboard)
            visibility = View.GONE
            setOnClickListener { sendRemoteClipboard() }
        }
        card.addView(remoteClipboardButton)
        return card
    }

    private fun startQrScan() {
        val activeTransport = connection?.transport
        if (activeTransport != null && activeTransport != "lan-tcp") {
            updateStatus("Disconnect the USB companion before pairing over LAN")
            return
        }
        updateStatus("Opening QR scanner…")
        barcodeScanner.startScan()
            .addOnSuccessListener { barcode ->
                val payload = barcode.rawValue
                if (payload.isNullOrBlank()) {
                    updateStatus("The QR code did not contain a pairing code")
                    appendLog("QR scan returned no text")
                } else {
                    pairingInput.setText(payload)
                    connectToLanPayload(payload)
                }
            }
            .addOnCanceledListener {
                updateStatus("QR scan cancelled")
            }
            .addOnFailureListener { error ->
                updateStatus("QR scanner unavailable; paste the manual pairing code")
                appendLog("QR scanner failed: ${error.message ?: "unknown error"}")
            }
    }

    private fun connectToLanPayload(payload: String) {
        if (!activityStarted) return
        val offer = try {
            LanPairing.parse(payload)
        } catch (error: IllegalArgumentException) {
            updateStatus(error.message ?: "Invalid LAN pairing code")
            appendLog("LAN pairing code rejected: ${error.message ?: "invalid code"}")
            return
        }

        val activeConnection = connection
        if (activeConnection != null) {
            if (activeConnection.transport != "lan-tcp") {
                updateStatus("Disconnect the USB companion before pairing over LAN")
                return
            }
            if (screenCaptureServiceStarted || ScreenCaptureService.isRunning()) {
                stopScreenCapture("Stopping screen sharing before replacing LAN pairing")
            }
            disconnectConnection("Replacing the previous LAN pairing offer")
            clearSavedLanOffer()
            appendLog("Replacing the previous LAN pairing offer")
        }
        connectToLan(offer)
    }

    private fun connectToLan(offer: LanPairingOffer) {
        if (!activityStarted || connection != null) return
        savedLanOffer = offer
        val generation = ++connectionGeneration
        val session = LanConnection(
            offer = offer,
            helloPayload = ProtocolJson.helloFrame(
                appName = getString(R.string.app_name),
                packageName = packageName,
                version = BuildConfig.VERSION_NAME,
                pairingToken = offer.token,
            ),
            requestHandler = protocolProcessor::prepare,
            listener = object : CompanionSessionListener {
                override fun onConnected() {
                    postToUi {
                        if (generation != connectionGeneration) return@postToUi
                        // Persist only after the desktop socket accepted a connection attempt;
                        // normal launches still discard it unless this process or screen share
                        // remains active.
                        saveLanOffer(offer)
                        updateStatus("Connected over LAN: ${offer.host}:${offer.port}")
                        appendLog("LAN stream opened; authenticated hello sent")
                    }
                }

                override fun onReconnecting(reason: String, attempt: Int, delayMs: Long) {
                    postToUi {
                        if (generation != connectionGeneration) return@postToUi
                        updateStatus("Reconnecting over LAN…")
                        appendLog("LAN reconnect attempt $attempt: $reason")
                    }
                }

                override fun onLog(message: String) {
                    appendLog(message)
                }

                override fun onDisconnected(reason: String) {
                    postToUi {
                        if (generation != connectionGeneration) return@postToUi
                        connection = null
                        updateStatus(
                            if (activityStarted) {
                                "LAN disconnected: $reason; retrying the saved pairing offer"
                            } else {
                                "LAN disconnected: $reason"
                            },
                        )
                        appendLog("LAN session closed: $reason")
                    }
                }
            },
        )
        connection = session
        updateStatus("Connecting over LAN to ${offer.host}:${offer.port}…")
        appendLog("Connecting to the desktop LAN pairing listener")
        session.start()
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerUsbReceiver() {
        val filter = IntentFilter().apply {
            addAction(permissionAction)
            addAction(UsbManager.ACTION_USB_ACCESSORY_DETACHED)
            addAction(ScreenCaptureService.ACTION_STATUS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(usbReceiver, filter)
        }
        receiverRegistered = true
    }

    private fun discoverAccessory() {
        if (!activityStarted || connection != null) return

        val accessories = try {
            usbManager.accessoryList?.toList().orEmpty()
        } catch (error: Exception) {
            appendLog("Unable to inspect USB accessories: ${error.message ?: "unknown error"}")
            updateStatus("Unable to inspect USB accessories")
            return
        }
        val accessory = accessories.firstOrNull(::matchesExpectedMetadata)
        if (accessory == null) {
            if (accessories.isEmpty()) {
                updateStatus("Waiting for desktop AOA handshake")
                appendLog(
                    "No AOA accessory found; keep this phone unlocked, then tap " +
                        "Start USB Companion in the desktop Connection Tools",
                )
            } else {
                updateStatus("AOA metadata mismatch; check the desktop host")
                appendLog(
                    "Ignoring ${accessories.size} non-matching accessory(s): " +
                        accessories.joinToString { describeAccessory(it) },
                )
            }
            return
        }

        appendLog("Found matching accessory: ${describeAccessory(accessory)}")
        connectToAccessory(accessory)
    }

    private fun connectToAccessory(accessory: UsbAccessory) {
        if (!activityStarted || connection != null) return
        if (!matchesExpectedMetadata(accessory)) {
            appendLog("Accessory metadata mismatch: ${describeAccessory(accessory)}; expected $EXPECTED_METADATA")
            updateStatus("AOA metadata mismatch; check the desktop host")
            return
        }

        val hasPermission = try {
            usbManager.hasPermission(accessory)
        } catch (error: Exception) {
            appendLog("Unable to check USB permission: ${error.message ?: "unknown error"}")
            updateStatus("Unable to check USB permission")
            return
        }
        if (!hasPermission) {
            requestAccessoryPermission(accessory)
            return
        }

        if (permissionAccessory == accessory) permissionAccessory = null
        openAccessory(accessory)
    }

    private fun requestAccessoryPermission(accessory: UsbAccessory) {
        when (val requested = permissionAccessory) {
            accessory -> {
                updateStatus("Waiting for USB permission; tap Allow in the system dialog")
                return
            }
            null -> Unit
            else -> {
                appendLog("A USB permission request is already pending for ${describeAccessory(requested)}")
                updateStatus("Waiting for the current USB permission request")
                return
            }
        }

        permissionAccessory = accessory
        try {
            usbManager.requestPermission(accessory, createPermissionIntent())
            appendLog("USB permission requested for ${describeAccessory(accessory)}; tap Allow")
            updateStatus("Waiting for USB permission; tap Allow in the system dialog")
        } catch (error: Exception) {
            permissionAccessory = null
            appendLog("Could not request USB permission: ${error.message ?: "unknown error"}")
            updateStatus("USB permission request failed; reconnect USB and try again")
        }
    }

    private fun handlePermissionResult(intent: Intent) {
        val accessory = accessoryFromIntent(intent)
        val requested = permissionAccessory
        permissionAccessory = null

        if (accessory == null) {
            appendLog("USB permission result did not identify an accessory")
            updateStatus("USB permission result was invalid; tap Check USB accessory")
            return
        }
        if (requested != null && requested != accessory) {
            appendLog("Ignoring stale USB permission result for ${describeAccessory(accessory)}")
            if (activityStarted) discoverAccessory()
            return
        }

        val grantedByResult = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        val stillHasPermission = try {
            usbManager.hasPermission(accessory)
        } catch (error: Exception) {
            appendLog("Unable to verify USB permission: ${error.message ?: "unknown error"}")
            false
        }
        if (!grantedByResult || !stillHasPermission) {
            if (pendingAccessory == accessory) pendingAccessory = null
            appendLog("USB permission denied for ${describeAccessory(accessory)}")
            updateStatus("USB permission required; reconnect USB and tap Allow")
            return
        }
        if (!matchesExpectedMetadata(accessory)) {
            appendLog("Ignoring permission result with unexpected metadata: ${describeAccessory(accessory)}")
            updateStatus("AOA metadata mismatch; check the desktop host")
            return
        }

        appendLog("USB permission granted for ${describeAccessory(accessory)}")
        if (activityStarted) {
            openAccessory(accessory)
        } else {
            pendingAccessory = accessory
            appendLog("Permission granted; reopen the app to connect")
        }
    }

    private fun handleAccessoryDetached(intent: Intent) {
        val accessory = accessoryFromIntent(intent)
        if (accessory != null && !matchesExpectedMetadata(accessory)) {
            appendLog("Unrelated USB accessory detached: ${describeAccessory(accessory)}")
            return
        }

        if (accessory == null || permissionAccessory == accessory) permissionAccessory = null
        if (accessory == null || pendingAccessory == accessory) pendingAccessory = null
        val description = accessory?.let(::describeAccessory) ?: "unknown accessory"
        appendLog("USB accessory detached: $description")
        if (connection != null && connection?.transport != "usb-accessory") {
            appendLog("LAN session remains active")
            return
        }
        disconnectConnection("USB accessory detached")
        updateStatus(if (activityStarted) "USB accessory detached; reconnect the host" else "USB accessory detached")
    }

    private fun openAccessory(accessory: UsbAccessory) {
        if (!activityStarted || connection != null) return
        val descriptor = try {
            usbManager.openAccessory(accessory)
        } catch (error: Exception) {
            appendLog("Could not open USB accessory: ${error.message ?: "unknown error"}")
            null
        }
        if (descriptor == null) {
            updateStatus("Unable to open USB accessory; reconnect USB and try again")
            return
        }

        val generation = ++connectionGeneration
        val session = AccessoryConnection(
            descriptor = descriptor,
            helloPayload = ProtocolJson.helloFrame(
                appName = getString(R.string.app_name),
                packageName = packageName,
                version = BuildConfig.VERSION_NAME,
            ),
            requestHandler = protocolProcessor::prepare,
            listener = object : CompanionSessionListener {
                override fun onConnected() {
                    postToUi {
                        if (generation != connectionGeneration) return@postToUi
                        updateStatus("Connected: ${describeAccessory(accessory)}")
                        appendLog("Accessory stream opened; hello with capabilities sent")
                    }
                }

                override fun onLog(message: String) {
                    appendLog(message)
                }

                override fun onDisconnected(reason: String) {
                    postToUi {
                        if (generation != connectionGeneration) return@postToUi
                        connection = null
                        updateStatus(
                            if (activityStarted) {
                                "Disconnected: $reason; tap Check USB accessory"
                            } else {
                                "Disconnected: $reason"
                            },
                        )
                        appendLog("Accessory session closed: $reason")
                    }
                }
            },
        )
        connection = session
        updateStatus("Connecting to ${describeAccessory(accessory)}...")
        appendLog("Opening USB accessory stream")
        session.start()
    }

    private fun disconnectConnection(reason: String) {
        stopRemoteControlLocal(reason)
        val oldConnection = connection ?: return
        connectionGeneration += 1
        connection = null
        oldConnection.stop(reason)
    }

    private fun dispatchRequest(request: ProtocolRequest): ProtocolHandlerResult = when (request.method) {
        "ping" -> ProtocolHandlerResult(JSONObjectFactory.objectWith("message" to "pong"))
        "get_device_info" -> ProtocolHandlerResult(deviceInfo())
        "clipboard_set" -> ProtocolHandlerResult(clipboardSet(request.params))
        "clipboard_get" -> ProtocolHandlerResult(clipboardGet())
        "open_url" -> openUrl(request.params)
        "start_screen_share" -> startScreenShare(request.params)
        "stop_screen_share" -> stopScreenShare()
        "start_remote_control" -> startRemoteControlRequest(request.params)
        "stop_remote_control" -> stopRemoteControlRequest()
        else -> throw IllegalArgumentException("unknown method: ${request.method}")
    }

    private fun startRemoteControlRequest(params: JSONObject): ProtocolHandlerResult {
        val offer = RemoteControlProtocol.parseOffer(params)
        val startAfterResponse = {
            val posted = mainHandler.post { startRemoteControl(offer) }
            if (!posted) appendLog("Could not start remote control on the main thread")
        }
        return ProtocolHandlerResult(
            result = JSONObjectFactory.objectWith(
                "accepted" to true,
                "generation" to offer.generation,
                "sessionId" to offer.sessionId,
                "target" to JSONObjectFactory.objectWith(
                    "serial" to offer.target.serial,
                    "label" to offer.target.label,
                ),
            ),
            afterResponse = startAfterResponse,
        )
    }

    private fun stopRemoteControlRequest(): ProtocolHandlerResult {
        val stopAfterResponse = {
            val posted = mainHandler.post { stopRemoteControlLocal("Stopped by the desktop") }
            if (!posted) appendLog("Could not stop remote control on the main thread")
        }
        return ProtocolHandlerResult(
            result = JSONObjectFactory.objectWith("stopped" to true),
            afterResponse = stopAfterResponse,
        )
    }

    private fun startRemoteControl(offer: RemoteControlOffer) {
        stopRemoteControlLocal("Replacing the previous remote control session")
        if (!activityStarted) {
            updateRemoteStatus("Reopen the app before using remote control", false)
            appendLog("Remote control request ignored because the Activity is not foreground")
            return
        }
        lateinit var session: RemoteControlSession
        session = RemoteControlSession(
            packageName = packageName,
            offer = offer,
            listener = object : RemoteControlSessionListener {
                override fun onConnected(target: RemoteTarget) {
                    postToUi {
                        if (remoteSession !== session) return@postToUi
                        updateRemoteStatus("Controlling ${target.label}", true)
                        appendLog("Remote control connected for ${target.serial}")
                        applyRemotePermissions(offer)
                        if ("view" in offer.permissions && remoteVideoSession == null) {
                            startRemoteVideo(offer)
                        }
                    }
                }

                override fun onReconnecting(reason: String, attempt: Int, delayMs: Long) {
                    postToUi {
                        if (remoteSession !== session) return@postToUi
                        updateRemoteStatus("Reconnecting remote control…", false)
                        appendLog("Remote reconnect $attempt in ${delayMs}ms: $reason")
                    }
                }

                override fun onDisconnected(reason: String) {
                    postToUi {
                        if (remoteSession !== session) return@postToUi
                        remoteSession = null
                        stopRemoteVideo()
                        updateRemoteStatus("Remote control unavailable", false)
                        appendLog("Remote control stopped: $reason")
                    }
                }

                override fun onLog(message: String) = appendLog(message)
            },
        )
        remoteSession = session
        updateRemoteStatus("Connecting to ${offer.target.label}…", false)
        appendLog("Opening remote control command socket for ${offer.target.serial}")
        session.start()
    }

    private fun stopRemoteControlLocal(reason: String) {
        val previous = remoteSession
        remoteSession = null
        previous?.stop(reason)
        stopRemoteVideo()
        pendingRemoteTouch = null
        remoteTouchInFlight = false
        updateRemoteStatus(getString(R.string.remote_control_waiting), false)
        if (::remoteVideoView.isInitialized) remoteVideoView.visibility = View.GONE
        if (::remoteTextInput.isInitialized) (remoteTextInput.tag as? View)?.visibility = View.GONE
        if (::remoteClipboardButton.isInitialized) remoteClipboardButton.visibility = View.GONE
    }

    private fun sendRemoteAction(method: String) {
        val session = remoteSession
        if (session == null || !session.isAvailable) {
            updateRemoteStatus("Remote control is not connected", false)
            return
        }
        setRemoteButtonsEnabled(false)
        session.requestAsync(method) { result ->
            postToUi {
                if (remoteSession !== session) return@postToUi
                result.onSuccess {
                    updateRemoteStatus("Controlling ${session.offer.target.label}", true)
                    appendLog("Remote action sent: $method")
                }.onFailure { error ->
                    updateRemoteStatus("Remote action failed", false)
                    appendLog("Remote action $method failed: ${error.message ?: "unknown error"}")
                }
            }
        }
    }

    private fun updateRemoteStatus(value: String, enabled: Boolean) {
        if (::remoteStatusView.isInitialized) remoteStatusView.text = value
        setRemoteButtonsEnabled(enabled)
    }

    private fun setRemoteButtonsEnabled(enabled: Boolean) {
        val canControl = remoteSession?.offer?.permissions?.let { permissions ->
            // Legacy phase-one offers had no explicit permissions and exposed navigation only.
            permissions.isEmpty() || "control" in permissions
        } ?: false
        remoteButtons.forEach { it.isEnabled = enabled && canControl }
        if (::remoteTextButton.isInitialized) {
            remoteTextButton.isEnabled = enabled && remoteSession?.offer?.permissions?.contains("keyboard") == true
        }
        if (::remoteClipboardButton.isInitialized) {
            remoteClipboardButton.isEnabled =
                enabled && remoteSession?.offer?.permissions?.contains("clipboard") == true
        }
    }

    private fun applyRemotePermissions(offer: RemoteControlOffer) {
        remoteVideoView.visibility = if ("view" in offer.permissions) View.VISIBLE else View.GONE
        (remoteTextInput.tag as? View)?.visibility =
            if ("keyboard" in offer.permissions) View.VISIBLE else View.GONE
        remoteClipboardButton.visibility =
            if ("clipboard" in offer.permissions) View.VISIBLE else View.GONE
        remoteTextButton.isEnabled = "keyboard" in offer.permissions
        remoteClipboardButton.isEnabled = "clipboard" in offer.permissions
    }

    private fun startRemoteVideo(offer: RemoteControlOffer) {
        stopRemoteVideo()
        val renderer = RemoteVideoRenderer(remoteVideoView, ::appendLog)
        remoteVideoRenderer = renderer
        lateinit var video: RemoteVideoSession
        video = RemoteVideoSession(
            packageName = packageName,
            offer = offer,
            listener = object : RemoteVideoSessionListener {
                override fun onVideoConnected() = appendLog("Remote target video connected")

                override fun onVideoReconnecting(reason: String, attempt: Int, delayMs: Long) {
                    renderer.resetForReconnect()
                    appendLog("Remote video reconnect $attempt in ${delayMs}ms: $reason")
                }

                override fun onVideoMessage(message: RemoteVideoMessage) {
                    if (remoteVideoSession !== video) return
                    when (message) {
                        is RemoteVideoMessage.Size -> {
                            remoteVideoWidth = message.width
                            remoteVideoHeight = message.height
                            renderer.setVideoSize(message.width, message.height)
                        }
                        is RemoteVideoMessage.Packet -> renderer.queue(message)
                        is RemoteVideoMessage.Codec -> appendLog("Remote video codec: ${message.name}")
                    }
                }

                override fun onVideoDisconnected(reason: String) {
                    postToUi {
                        if (remoteVideoSession !== video) return@postToUi
                        appendLog("Remote target video stopped: $reason")
                        remoteVideoSession = null
                        renderer.release()
                        if (remoteVideoRenderer === renderer) remoteVideoRenderer = null
                    }
                }
            },
        )
        remoteVideoSession = video
        video.start()
    }

    private fun stopRemoteVideo() {
        remoteVideoSession?.stop()
        remoteVideoSession = null
        remoteVideoRenderer?.release()
        remoteVideoRenderer = null
        remoteVideoWidth = 0
        remoteVideoHeight = 0
    }

    private fun handleRemoteTouch(event: MotionEvent): Boolean {
        val session = remoteSession ?: return false
        if (!session.isAvailable || "control" !in session.offer.permissions) return false
        val action = when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> "down"
            MotionEvent.ACTION_MOVE -> "move"
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> "up"
            MotionEvent.ACTION_CANCEL -> "cancel"
            else -> return false
        }
        remoteVideoView.parent?.requestDisallowInterceptTouchEvent(
            action != "up" && action != "cancel",
        )
        if (action == "move") {
            val now = SystemClock.uptimeMillis()
            if (now - lastRemoteMoveAt < REMOTE_MOVE_INTERVAL_MS) return true
            lastRemoteMoveAt = now
        }
        val actionIndex = event.actionIndex.coerceIn(0, event.pointerCount - 1)
        val point = RemoteCoordinateMapper.map(
            event.getX(actionIndex),
            event.getY(actionIndex),
            remoteVideoView.width,
            remoteVideoView.height,
            remoteVideoWidth,
            remoteVideoHeight,
        ) ?: return true
        remoteVideoView.requestFocus()
        enqueueRemoteTouch(
            JSONObject()
                .put("action", action)
                .put("pointerId", event.getPointerId(actionIndex).toLong())
                .put("x", point.x)
                .put("y", point.y)
                .put("deviceWidth", remoteVideoWidth)
                .put("deviceHeight", remoteVideoHeight)
                .put("pressure", event.getPressure(actionIndex).toDouble().coerceIn(0.0, 1.0)),
        )
        return true
    }

    private fun enqueueRemoteTouch(params: JSONObject) {
        val session = remoteSession ?: return
        if (remoteTouchInFlight) {
            pendingRemoteTouch = params
            return
        }
        remoteTouchInFlight = true
        session.requestAsync("touch", params) { result ->
            postToUi {
                if (remoteSession !== session) return@postToUi
                remoteTouchInFlight = false
                result.onFailure { appendLog("Remote touch failed: ${it.message ?: "unknown error"}") }
                val next = pendingRemoteTouch
                pendingRemoteTouch = null
                if (next != null && session.isAvailable) enqueueRemoteTouch(next)
            }
        }
    }

    private fun handleRemoteKey(keyCode: Int, event: KeyEvent): Boolean {
        val session = remoteSession ?: return false
        if (!session.isAvailable || "keyboard" !in session.offer.permissions) return false
        if (event.action != KeyEvent.ACTION_DOWN && event.action != KeyEvent.ACTION_UP) return false
        session.requestAsync(
            "key",
            JSONObject()
                .put("keycode", keyCode)
                .put("metastate", event.metaState)
                .put("action", if (event.action == KeyEvent.ACTION_DOWN) "down" else "up"),
        ) { result ->
            result.onFailure { appendLog("Remote key failed: ${it.message ?: "unknown error"}") }
        }
        return true
    }

    private fun sendRemoteText() {
        val text = remoteTextInput.text.toString()
        if (text.isEmpty()) return
        if (!RemoteInputLimits.isTextAllowed(text)) {
            appendLog("Remote text is limited to ${RemoteInputLimits.TEXT_UTF8_BYTES} UTF-8 bytes")
            return
        }
        sendRemoteParams("text", JSONObject().put("text", text)) {
            remoteTextInput.text.clear()
        }
    }

    private fun sendRemoteClipboard() {
        val text = clipboardManager.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
        if (text.isNullOrEmpty()) {
            appendLog("Local clipboard does not contain text")
            return
        }
        if (!RemoteInputLimits.isClipboardAllowed(text)) {
            appendLog(
                "Remote clipboard is limited to ${RemoteInputLimits.CLIPBOARD_UTF8_BYTES} UTF-8 bytes",
            )
            return
        }
        sendRemoteParams("clipboard_set", JSONObject().put("text", text)) {
            appendLog("Local clipboard sent to the target")
        }
    }

    private fun sendRemoteParams(method: String, params: JSONObject, onSuccess: () -> Unit = {}) {
        val session = remoteSession ?: return
        session.requestAsync(method, params) { result ->
            postToUi {
                if (remoteSession !== session) return@postToUi
                result.onSuccess { onSuccess() }
                    .onFailure { appendLog("Remote $method failed: ${it.message ?: "unknown error"}") }
            }
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        val session = remoteSession
        if (session?.isAvailable == true &&
            (session.offer.permissions.isEmpty() || "control" in session.offer.permissions)
        ) {
            sendRemoteAction("back")
        } else {
            super.onBackPressed()
        }
    }

    private fun startScreenShare(params: JSONObject): ProtocolHandlerResult {
        if (connection?.transport != "lan-tcp") {
            throw IllegalArgumentException("Screen sharing requires a QR / LAN connection")
        }
        if (!activityStarted) {
            throw IllegalStateException(
                "Reopen the Companion app before starting screen sharing",
            )
        }
        val offer = LanPairing.parseScreenOffer(params)
        val requestPermission = {
            val posted = mainHandler.post { requestScreenCapture(offer) }
            if (!posted) appendLog("Could not open the Android screen-capture permission dialog")
        }
        return ProtocolHandlerResult(
            result = JSONObjectFactory.objectWith(
                "accepted" to true,
                "state" to "permission_required",
                "generation" to offer.generation,
                "format" to "jpeg",
            ),
            afterResponse = requestPermission,
        )
    }

    private fun stopScreenShare(): ProtocolHandlerResult {
        val stopAfterResponse = {
            val posted = mainHandler.post { stopScreenCapture("Stopped by the desktop") }
            if (!posted) appendLog("Could not stop the Android screen capture on the main thread")
        }
        return ProtocolHandlerResult(
            result = JSONObjectFactory.objectWith("stopped" to true),
            afterResponse = stopAfterResponse,
        )
    }

    private fun requestScreenCapture(offer: ScreenStreamOffer) {
        if (!activityStarted) {
            val reason = "Reopen the Companion app before approving screen capture"
            ScreenCaptureSession.reportFailure(this, offer, reason)
            appendLog("Screen capture request ignored because the Activity is not foreground")
            updateStatus(reason)
            return
        }
        stopScreenCapture("Replacing the previous screen stream")
        pendingScreenOffer = offer
        awaitingScreenPermission = true
        updateStatus("Approve screen capture in the Android system dialog")
        appendLog("Desktop requested screen sharing; waiting for the Android permission dialog")
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (manager == null) {
            val reason = "Screen capture is unavailable on this Android device"
            ScreenCaptureSession.reportFailure(this, offer, reason)
            pendingScreenOffer = null
            awaitingScreenPermission = false
            updateStatus(reason)
            appendLog("MediaProjectionManager was not available")
            return
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST_CODE)
        } catch (error: Exception) {
            val reason = "Could not open the screen-capture permission dialog"
            ScreenCaptureSession.reportFailure(this, offer, reason)
            pendingScreenOffer = null
            awaitingScreenPermission = false
            updateStatus(reason)
            appendLog("MediaProjection permission request failed: ${error.message ?: "unknown error"}")
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != SCREEN_CAPTURE_REQUEST_CODE) return

        awaitingScreenPermission = false
        val offer = pendingScreenOffer
        pendingScreenOffer = null
        if (offer == null) {
            appendLog("Ignoring a screen-capture result without a pending stream")
            return
        }
        if (resultCode != Activity.RESULT_OK || data == null) {
            val reason = "Screen capture permission was denied"
            ScreenCaptureSession.reportFailure(this, offer, reason)
            screenCaptureServiceStarted = false
            screenCaptureGeneration = 0L
            updateStatus(reason)
            appendLog("Android screen-capture permission was denied")
            return
        }

        screenCaptureGeneration = offer.generation

        val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_START
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_PROJECTION_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_HOST, offer.host)
            putExtra(ScreenCaptureService.EXTRA_PORT, offer.port)
            putExtra(ScreenCaptureService.EXTRA_TOKEN, offer.token)
            putExtra(ScreenCaptureService.EXTRA_GENERATION, offer.generation)
            putExtra(ScreenCaptureService.EXTRA_MAX_WIDTH, offer.maxWidth)
            putExtra(ScreenCaptureService.EXTRA_MAX_HEIGHT, offer.maxHeight)
            putExtra(ScreenCaptureService.EXTRA_MAX_FPS, offer.maxFps)
            putExtra(ScreenCaptureService.EXTRA_JPEG_QUALITY, offer.jpegQuality)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                @Suppress("DEPRECATION")
                startService(serviceIntent)
            }
            screenCaptureServiceStarted = true
            updateStatus("Starting Android screen capture…")
            appendLog("Android screen capture permission granted; foreground service starting")
        } catch (error: Exception) {
            val reason = "Could not start the Android screen-capture service"
            ScreenCaptureSession.reportFailure(this, offer, reason)
            screenCaptureServiceStarted = false
            screenCaptureGeneration = 0L
            updateStatus(reason)
            appendLog("Screen-capture service failed to start: ${error.message ?: "unknown error"}")
        }
    }

    private fun handleScreenCaptureStatus(intent: Intent) {
        val generation = intent.getLongExtra(ScreenCaptureService.EXTRA_GENERATION, 0L)
        if (
            generation != 0L &&
            screenCaptureGeneration != 0L &&
            generation != screenCaptureGeneration
        ) {
            appendLog("Ignoring stale screen-capture service status for generation $generation")
            return
        }

        val stage = intent.getStringExtra(ScreenCaptureService.EXTRA_STATUS).orEmpty()
        val reason = intent.getStringExtra(ScreenCaptureService.EXTRA_REASON)
            ?.takeIf { it.isNotBlank() }
            ?: "Screen capture service status changed"
        when (stage) {
            ScreenCaptureService.STATUS_STARTED -> {
                if (generation != 0L) screenCaptureGeneration = generation
                screenCaptureServiceStarted = true
                updateStatus("Streaming Android screen to the desktop")
                appendLog("Android screen-capture service is running")
            }
            ScreenCaptureService.STATUS_STOPPED,
            ScreenCaptureService.STATUS_ERROR -> {
                screenCaptureServiceStarted = false
                screenCaptureGeneration = 0L
                updateStatus(
                    if (stage == ScreenCaptureService.STATUS_ERROR) {
                        "Android screen capture stopped: $reason"
                    } else {
                        "Android screen capture stopped"
                    },
                )
                appendLog(reason)
            }
        }
    }

    private fun stopScreenCapture(reason: String) {
        screenCaptureServiceStarted = false
        screenCaptureGeneration = 0L
        pendingScreenOffer = null
        awaitingScreenPermission = false
        val stopIntent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_STOP
        }
        if (ScreenCaptureService.isRunning()) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startService(stopIntent)
                } else {
                    @Suppress("DEPRECATION")
                    startService(stopIntent)
                }
            } catch (_: Exception) {
                stopService(stopIntent)
            }
        } else {
            stopService(stopIntent)
        }
        if (reason.isNotBlank()) appendLog(reason)
    }

    private fun deviceInfo(): JSONObject = JSONObjectFactory.objectWith(
        "app" to getString(R.string.app_name),
        "package" to packageName,
        "version" to BuildConfig.VERSION_NAME,
        "model" to Build.MODEL,
    )

    private fun clipboardSet(params: JSONObject): JSONObject {
        val text = params.opt("text") as? String
            ?: throw IllegalArgumentException("params.text must be a string")
        ProtocolInputValidator.requireValidClipboardText(text)
        clipboardManager.setPrimaryClip(ClipData.newPlainText("Scrcpy GUI Plus", text))
        return JSONObjectFactory.objectWith("accepted" to true, "textLength" to text.length)
    }

    private fun clipboardGet(): JSONObject {
        val clip = clipboardManager.primaryClip
        val text = if (clip != null && clip.itemCount > 0) {
            clip.getItemAt(0).coerceToText(this).toString()
        } else {
            null
        }
        return JSONObjectFactory.objectWith("text" to (text ?: JSONObject.NULL))
    }

    private fun openUrl(params: JSONObject): ProtocolHandlerResult {
        val url = params.opt("url") as? String
            ?: throw IllegalArgumentException("params.url must be a string")
        if (url.isBlank()) throw IllegalArgumentException("params.url must not be blank")

        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase(Locale.US)
        if (scheme != "http" && scheme != "https") {
            throw IllegalArgumentException("params.url must use http or https")
        }
        ProtocolInputValidator.requireValidUrl(url)

        val launchAfterResponse = {
            val posted = mainHandler.post {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (error: Exception) {
                    appendLog("URL launch failed after its response was sent: ${error.message ?: "unknown error"}")
                }
            }
            if (!posted) appendLog("URL launch could not be posted after its response was sent")
        }
        return ProtocolHandlerResult(
            result = JSONObjectFactory.objectWith("opened" to true, "url" to url),
            afterResponse = launchAfterResponse,
        )
    }

    private fun saveLanOffer(offer: LanPairingOffer) {
        pairingPreferences.edit()
            .putString(PAIRING_HOST, offer.host)
            .putInt(PAIRING_PORT, offer.port)
            .putString(PAIRING_TOKEN, offer.token)
            .apply()
    }

    private fun clearSavedLanOffer() {
        savedLanOffer = null
        pairingPreferences.edit().clear().apply()
    }

    private fun loadSavedLanOffer(): LanPairingOffer? {
        val host = pairingPreferences.getString(PAIRING_HOST, null)
        val port = pairingPreferences.getInt(PAIRING_PORT, 0)
        val token = pairingPreferences.getString(PAIRING_TOKEN, null)
        if (host.isNullOrBlank() || port !in 1..65535 || token.isNullOrBlank()) return null

        return runCatching {
            LanPairing.parse(
                "scrcpy-gui-plus://pair?v=1&host=$host&port=$port&token=$token",
            )
        }.getOrElse {
            pairingPreferences.edit().clear().apply()
            null
        }
    }

    private fun createPermissionIntent(): PendingIntent {
        val intent = Intent(permissionAction).setPackage(packageName)
        val mutabilityFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
        } else {
            0
        }
        return PendingIntent.getBroadcast(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutabilityFlag,
        )
    }

    private fun handleAccessoryIntent(intent: Intent?) {
        if (intent?.action != UsbManager.ACTION_USB_ACCESSORY_ATTACHED) return
        val accessory = accessoryFromIntent(intent)
        if (accessory == null) {
            appendLog("USB attach intent did not identify an accessory")
            return
        }
        if (!matchesExpectedMetadata(accessory)) {
            appendLog("Ignoring attached accessory with unexpected metadata: ${describeAccessory(accessory)}")
            updateStatus("AOA metadata mismatch; check the desktop host")
            return
        }

        pendingAccessory = accessory
        appendLog("USB accessory attached: ${describeAccessory(accessory)}")
        if (activityStarted) {
            pendingAccessory = null
            connectToAccessory(accessory)
        }
    }

    @Suppress("DEPRECATION")
    private fun accessoryFromIntent(intent: Intent): UsbAccessory? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(UsbManager.EXTRA_ACCESSORY, UsbAccessory::class.java)
        } else {
            intent.getParcelableExtra(UsbManager.EXTRA_ACCESSORY)
        }
    }

    private fun matchesExpectedMetadata(accessory: UsbAccessory): Boolean =
        accessory.manufacturer == AOA_MANUFACTURER &&
            accessory.model == AOA_MODEL &&
            accessory.version == AOA_VERSION

    private fun describeAccessory(accessory: UsbAccessory): String =
        "${accessory.manufacturer ?: "<unknown manufacturer>"} / " +
            "${accessory.model ?: "<unknown model>"} / " +
            "v${accessory.version ?: "<unknown>"}"

    private fun updateStatus(value: String) {
        if (::statusView.isInitialized) statusView.text = value
    }

    private fun appendLog(message: String) {
        val compactMessage = message
            .replace('\n', ' ')
            .replace('\r', ' ')
            .take(MAX_LOG_MESSAGE_CHARS)
        postToUi {
            if (!::logView.isInitialized) return@postToUi
            if (logs.size >= MAX_LOG_LINES) logs.removeFirst()
            logs.addLast(compactMessage)
            logView.text = logs.joinToString("\n")
        }
    }

    private fun postToUi(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).roundToInt()

    private companion object {
        const val AOA_MANUFACTURER = "Scrcpy GUI Plus"
        const val AOA_MODEL = "Companion"
        const val AOA_VERSION = "1"
        const val EXPECTED_METADATA = "$AOA_MANUFACTURER / $AOA_MODEL / v$AOA_VERSION"
        const val MAX_LOG_LINES = 12
        const val MAX_LOG_MESSAGE_CHARS = 400
        const val REMOTE_MOVE_INTERVAL_MS = 16L
        const val SCREEN_CAPTURE_REQUEST_CODE = 4
        const val PAIRING_PREFERENCES = "lan_pairing"
        const val PAIRING_HOST = "host"
        const val PAIRING_PORT = "port"
        const val PAIRING_TOKEN = "token"
        const val STATE_PROCESS_INSTANCE_ID = "process_instance_id"
        val PROCESS_INSTANCE_ID: String = java.util.UUID.randomUUID().toString()
    }
}

/** Keeps small result objects readable without introducing a runtime JSON library dependency. */
private object JSONObjectFactory {
    fun objectWith(vararg values: Pair<String, Any?>): JSONObject {
        val objectValue = JSONObject()
        values.forEach { (key, value) -> objectValue.put(key, value) }
        return objectValue
    }
}
