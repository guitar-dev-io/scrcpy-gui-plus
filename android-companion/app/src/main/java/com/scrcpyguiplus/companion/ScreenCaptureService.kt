package com.scrcpyguiplus.companion

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder

/** Owns MediaProjection so Android 14+ can enforce the mediaProjection FGS contract. */
class ScreenCaptureService : Service() {
    @Volatile
    private var captureSession: ScreenCaptureSession? = null

    @Volatile
    private var activeGeneration = 0L

    @Volatile
    private var stoppingSession = false

    override fun onCreate() {
        super.onCreate()
        serviceRunning = false
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                val generation = activeGeneration
                stopCapture("Stopped by the desktop")
                publishStatus(STATUS_STOPPED, "Screen capture stopped", generation)
                activeGeneration = 0L
                stopSelfResult(startId)
            }
            ACTION_START -> startCapture(intent)
            else -> stopSelfResult(startId)
        }
        return START_NOT_STICKY
    }

    private fun startCapture(intent: Intent) {
        stopCapture("Replacing the previous screen capture")
        val generation = intent.getLongExtra(EXTRA_GENERATION, 0L)
        activeGeneration = generation
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
                )
            } else {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }
            serviceRunning = true

            val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            val projectionData = intent.parcelableExtra<Intent>(EXTRA_PROJECTION_DATA)
                ?: throw IllegalArgumentException("MediaProjection permission data is missing")
            require(resultCode == Activity.RESULT_OK) { "MediaProjection permission was not granted" }

            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as? MediaProjectionManager
                ?: throw IllegalStateException("MediaProjectionManager is unavailable")
            val projection = manager.getMediaProjection(resultCode, projectionData)
                ?: throw IllegalStateException("Could not create MediaProjection")
            val offer = offerFromIntent(intent, generation)
            val session = ScreenCaptureSession(
                context = this,
                offer = offer,
                listener = object : ScreenCaptureSession.Listener {
                    override fun onLog(message: String) {
                        android.util.Log.i(TAG, message)
                    }

                    override fun onStopped(reason: String) {
                        if (activeGeneration != generation) return
                        captureSession = null
                        android.util.Log.i(TAG, "Screen capture stopped: $reason")
                        if (!stoppingSession) {
                            ScreenCaptureSession.reportFailure(this@ScreenCaptureService, offer, reason)
                            publishStatus(STATUS_ERROR, reason, generation)
                            stopSelf()
                        }
                    }
                },
            )
            captureSession = session
            session.start(projection)
            publishStatus(
                STATUS_STARTED,
                "Foreground service owns the Android screen capture",
                generation,
            )
        } catch (error: Exception) {
            val reason = "Screen capture failed: ${error.safeMessage()}"
            android.util.Log.e(TAG, reason, error)
            runCatching {
                ScreenCaptureSession.reportFailure(
                    this,
                    offerFromIntent(intent, generation),
                    reason,
                )
            }
            stopCapture(reason)
            publishStatus(STATUS_ERROR, reason, generation)
            stopSelf()
        }
    }

    private fun offerFromIntent(intent: Intent, generation: Long): ScreenStreamOffer =
        ScreenStreamOffer(
            host = intent.getStringExtra(EXTRA_HOST).orEmpty(),
            port = intent.getIntExtra(EXTRA_PORT, 0),
            token = intent.getStringExtra(EXTRA_TOKEN).orEmpty(),
            generation = generation,
            maxWidth = intent.getIntExtra(EXTRA_MAX_WIDTH, 1280),
            maxHeight = intent.getIntExtra(EXTRA_MAX_HEIGHT, 1280),
            maxFps = intent.getIntExtra(EXTRA_MAX_FPS, 12),
            jpegQuality = intent.getIntExtra(EXTRA_JPEG_QUALITY, 60),
        )

    private fun stopCapture(reason: String) {
        val session = captureSession ?: return
        captureSession = null
        stoppingSession = true
        try {
            session.stop(reason)
        } finally {
            stoppingSession = false
        }
    }

    private fun publishStatus(stage: String, reason: String, generation: Long) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_STATUS, stage)
                .putExtra(EXTRA_REASON, reason)
                .putExtra(EXTRA_GENERATION, generation),
        )
    }

    override fun onDestroy() {
        stopCapture("Screen capture service destroyed")
        serviceRunning = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Scrcpy GUI Plus Companion")
            .setContentText("Sharing the Android screen with the desktop")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Screen sharing",
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun Exception.safeMessage(): String =
        (message ?: "unknown error")
            .replace('\n', ' ')
            .replace('\r', ' ')
            .take(200)

    private inline fun <reified T : android.os.Parcelable> Intent.parcelableExtra(name: String): T? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getParcelableExtra(name, T::class.java)
        } else {
            @Suppress("DEPRECATION")
            getParcelableExtra(name)
        }
    }

    companion object {
        const val ACTION_START = "com.scrcpyguiplus.companion.START_SCREEN_CAPTURE"
        const val ACTION_STOP = "com.scrcpyguiplus.companion.STOP_SCREEN_CAPTURE"
        const val ACTION_STATUS = "com.scrcpyguiplus.companion.SCREEN_CAPTURE_STATUS"
        const val STATUS_STARTED = "started"
        const val STATUS_STOPPED = "stopped"
        const val STATUS_ERROR = "error"
        const val EXTRA_STATUS = "status"
        const val EXTRA_REASON = "reason"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_PROJECTION_DATA = "projectionData"
        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_GENERATION = "generation"
        const val EXTRA_MAX_WIDTH = "maxWidth"
        const val EXTRA_MAX_HEIGHT = "maxHeight"
        const val EXTRA_MAX_FPS = "maxFps"
        const val EXTRA_JPEG_QUALITY = "jpegQuality"
        private const val CHANNEL_ID = "companion_screen_share"
        private const val NOTIFICATION_ID = 4107
        private const val TAG = "CompanionScreen"

        @Volatile
        private var serviceRunning = false

        fun isRunning(): Boolean = serviceRunning
    }
}
