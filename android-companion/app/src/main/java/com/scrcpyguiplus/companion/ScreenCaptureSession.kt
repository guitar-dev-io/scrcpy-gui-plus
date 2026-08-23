package com.scrcpyguiplus.companion

import android.content.Context
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.DisplayMetrics
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.json.JSONObject

/**
 * Foreground-owned MediaProjection capture for the QR/LAN screen stream.
 *
 * The control socket stays JSON request/response only. This class owns a second
 * TCP socket and sends one authenticated hello followed by bounded JPEG frames.
 * A LAN failure only replaces that second socket: the MediaProjection and
 * ImageReader stay alive while the connector retries the same authenticated
 * offer, so a transient Wi-Fi change does not require a new permission dialog.
 */
class ScreenCaptureSession(
    private val context: Context,
    private val offer: ScreenStreamOffer,
    private val listener: Listener,
) {
    interface Listener {
        fun onConnecting() {}
        fun onReconnecting(reason: String, attempt: Int, delayMs: Long) {}
        fun onLog(message: String)
        fun onStopped(reason: String)
    }

    private data class CaptureResources(
        val reader: ImageReader?,
        val display: android.hardware.display.VirtualDisplay?,
        val projection: MediaProjection?,
        val callback: MediaProjection.Callback?,
        val thread: HandlerThread?,
    )

    @Volatile
    private var running = false

    @Volatile
    private var socket: Socket? = null

    @Volatile
    private var connectionReady = false

    @Volatile
    private var output: BufferedOutputStream? = null
    private var projection: MediaProjection? = null
    private var virtualDisplay: android.hardware.display.VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var worker: Thread? = null
    private var lastFrameAtMs = 0L
    private val imageCallbackCount = AtomicLong(0)
    private val sentFrameCount = AtomicLong(0)
    private val frameInFlight = AtomicBoolean(false)
    private val stoppedNotified = AtomicBoolean(false)
    private val writer: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "companion-screen-writer").apply { isDaemon = true }
    }
    private val writeWatchdog: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "companion-screen-write-watchdog").apply { isDaemon = true }
    }
    private val outputLock = Any()
    private val connectionSignal = Object()
    private val captureLock = Any()

    @Synchronized
    fun start(mediaProjection: MediaProjection) {
        if (running) return
        running = true
        connectionReady = false
        stoppedNotified.set(false)
        lastFrameAtMs = 0L
        imageCallbackCount.set(0)
        sentFrameCount.set(0)
        projection = mediaProjection
        worker = Thread({ connectAndCapture(mediaProjection) }, "companion-screen-connect").apply {
            isDaemon = true
            start()
        }
    }

    fun stop(reason: String = "Screen sharing stopped") {
        stopInternal(reason, stopProjection = true)
    }

    private fun connectAndCapture(mediaProjection: MediaProjection) {
        val address = try {
            val resolved = InetAddress.getByName(offer.host)
            requirePrivateIpv4(resolved)
            resolved
        } catch (error: Exception) {
            if (running) {
                stopInternal("Screen stream host is unavailable: ${error.safeMessage()}", true)
            }
            return
        }

        val dimensions = calculateDimensions(context.resources.displayMetrics)
        val helloPayload = ProtocolJson.encode(
            JSONObject()
                .put("type", "screen_hello")
                .put("protocol", 1)
                .put("package", context.packageName)
                .put("token", offer.token)
                .put("generation", offer.generation)
                .put("format", "jpeg")
                .put("width", dimensions.first)
                .put("height", dimensions.second),
        )
        var captureConfigured = false
        var reconnectAttempt = 0
        var reconnectDeadlineMs = SystemClock.elapsedRealtime() + RECONNECT_WINDOW_MS
        safeConnecting()

        while (running) {
            var connectedSocket: Socket? = null
            try {
                val socketToConnect = Socket()
                connectedSocket = socketToConnect
                socket = socketToConnect
                socketToConnect.tcpNoDelay = true
                socketToConnect.connect(
                    InetSocketAddress(address, offer.port),
                    CONNECT_TIMEOUT_MS,
                )
                if (!running) return

                val connectedOutput = BufferedOutputStream(socketToConnect.getOutputStream())
                val handshakeReady = synchronized(outputLock) {
                    if (!running || socket !== socketToConnect) {
                        false
                    } else {
                        // Publish the hello before creating the ImageReader. Creating the
                        // virtual display first can invoke onImageAvailable immediately,
                        // allowing a JPEG frame to race ahead of the hello.
                        FrameCodec.writeFrame(connectedOutput, helloPayload)
                        output = connectedOutput
                        connectionReady = true
                        true
                    }
                }
                if (!handshakeReady) return

                if (!captureConfigured) {
                    try {
                        setupCapture(mediaProjection, dimensions)
                        captureConfigured = true
                    } catch (error: Exception) {
                        stopInternal("Screen capture setup failed: ${error.safeMessage()}", true)
                        return
                    }
                }

                reconnectAttempt = 0
                safeLog(
                    "Screen stream connected to ${offer.host}:${offer.port} at " +
                        "${dimensions.first}x${dimensions.second}",
                )
                awaitConnectionLoss(socketToConnect)
                if (!running) return

                // A successful capture socket gets a fresh reconnect window if it drops.
                reconnectDeadlineMs = SystemClock.elapsedRealtime() + RECONNECT_WINDOW_MS
                reconnectAttempt = 0
            } catch (error: InterruptedException) {
                if (!running) return
            } catch (error: Exception) {
                if (!running) return
                safeLog("Screen stream connection attempt failed: ${error.safeMessage()}")
            } finally {
                connectedSocket?.let(::closeConnectionIfCurrent)
            }

            if (!running) return
            val remainingMs = reconnectDeadlineMs - SystemClock.elapsedRealtime()
            if (remainingMs <= 0L) {
                stopInternal("Screen stream could not reconnect within the retry window", true)
                return
            }

            val delayMs = min(
                RECONNECT_MAX_DELAY_MS,
                RECONNECT_INITIAL_DELAY_MS shl reconnectAttempt.coerceAtMost(3),
            )
            safeReconnecting(
                "Screen stream socket lost; retrying the same authenticated offer",
                reconnectAttempt + 1,
                delayMs,
            )
            safeLog("Screen stream reconnecting in ${delayMs}ms")
            if (!waitForReconnect(min(delayMs, remainingMs))) return
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(4)
        }
    }

    private fun setupCapture(
        mediaProjection: MediaProjection,
        dimensions: Pair<Int, Int>,
    ) {
        val metrics = context.resources.displayMetrics
        val reader = ImageReader.newInstance(
            dimensions.first,
            dimensions.second,
            android.graphics.PixelFormat.RGBA_8888,
            2,
        )
        val thread = HandlerThread("companion-screen-capture").apply { start() }
        val handler = Handler(thread.looper)

        val callback = object : MediaProjection.Callback() {
            override fun onStop() {
                stopInternal("Android stopped screen capture", stopProjection = false)
            }
        }

        synchronized(captureLock) {
            if (!running) {
                reader.close()
                thread.quitSafely()
                return
            }
            imageReader = reader
            captureThread = thread
            captureHandler = handler
            projectionCallback = callback
            mediaProjection.registerCallback(callback, handler)
            reader.setOnImageAvailableListener(
                { availableReader -> onImageAvailable(availableReader, dimensions) },
                handler,
            )
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "Scrcpy GUI Plus Companion",
                dimensions.first,
                dimensions.second,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface,
                null,
                handler,
            )
        }
        safeLog("Screen capture virtual display ready at ${dimensions.first}x${dimensions.second}")
    }

    private fun onImageAvailable(reader: ImageReader, dimensions: Pair<Int, Int>) {
        if (!running || !connectionReady) {
            reader.acquireLatestImage()?.close()
            return
        }
        val callbackNumber = imageCallbackCount.incrementAndGet()
        if (callbackNumber == 1L) {
            safeLog("Screen capture received the first ImageReader callback")
        }
        val now = SystemClock.elapsedRealtime()
        val frameInterval = 1_000L / offer.maxFps.coerceAtLeast(1)
        if (now - lastFrameAtMs < frameInterval) {
            reader.acquireLatestImage()?.close()
            return
        }
        lastFrameAtMs = now
        if (!frameInFlight.compareAndSet(false, true)) {
            reader.acquireLatestImage()?.close()
            return
        }

        val image = reader.acquireLatestImage()
        if (image == null) {
            if (callbackNumber <= 3L) {
                safeLog("Screen capture callback $callbackNumber had no image")
            }
            frameInFlight.set(false)
            return
        }
        val bitmap = try {
            imageToBitmap(image, dimensions.first, dimensions.second)
        } catch (error: Exception) {
            safeLog("Could not copy a captured screen image: ${error.safeMessage()}")
            null
        } finally {
            image.close()
        }
        if (bitmap == null) {
            frameInFlight.set(false)
            return
        }

        try {
            writer.execute {
                try {
                    if (!running) return@execute
                    val jpeg = ByteArrayOutputStream().use { bytes ->
                        check(bitmap.compress(Bitmap.CompressFormat.JPEG, offer.jpegQuality, bytes)) {
                            "Bitmap JPEG compression failed"
                        }
                        bytes.toByteArray()
                    }
                    if (jpeg.size > FrameCodec.MAX_SCREEN_PAYLOAD_BYTES) {
                        throw IOException("JPEG frame is too large: ${jpeg.size} bytes")
                    }

                    var failedOutput: BufferedOutputStream? = null
                    var transportError: Exception? = null
                    synchronized(outputLock) {
                        val stream = output
                        val writeSocket = socket
                        if (running && connectionReady && stream != null && writeSocket != null) {
                            val timeoutTask = writeWatchdog.schedule({
                                if (
                                    running &&
                                        connectionReady &&
                                        socket === writeSocket &&
                                        output === stream
                                ) {
                                    handleTransportFailure(
                                        stream,
                                        IOException("Screen frame write timed out"),
                                    )
                                }
                            }, FRAME_WRITE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                            try {
                                FrameCodec.writeScreenFrame(stream, jpeg)
                                val frameNumber = sentFrameCount.incrementAndGet()
                                if (frameNumber == 1L || frameNumber % 60L == 0L) {
                                    safeLog("Screen JPEG frame $frameNumber sent")
                                }
                            } catch (error: Exception) {
                                failedOutput = stream
                                transportError = error
                            } finally {
                                timeoutTask.cancel(false)
                            }
                        }
                    }
                    if (transportError != null && failedOutput != null && running) {
                        handleTransportFailure(failedOutput!!, transportError!!)
                    }
                } catch (error: Exception) {
                    if (running) {
                        safeLog("Screen frame preparation failed: ${error.safeMessage()}")
                    }
                } finally {
                    bitmap.recycle()
                    frameInFlight.set(false)
                }
            }
        } catch (error: Exception) {
            bitmap.recycle()
            frameInFlight.set(false)
            if (running) safeLog("Screen writer stopped: ${error.safeMessage()}")
        }
    }

    private fun awaitConnectionLoss(expectedSocket: Socket) {
        synchronized(connectionSignal) {
            while (running && socket === expectedSocket && connectionReady) {
                try {
                    connectionSignal.wait()
                } catch (_: InterruptedException) {
                    if (!running) return
                }
            }
        }
    }

    private fun waitForReconnect(delayMs: Long): Boolean {
        if (delayMs <= 0L || !running) return running
        synchronized(connectionSignal) {
            if (!running) return false
            try {
                connectionSignal.wait(delayMs)
            } catch (_: InterruptedException) {
                if (!running) return false
            }
        }
        return running
    }

    private fun handleTransportFailure(
        failedOutput: BufferedOutputStream,
        error: Exception,
    ) {
        if (!running) return
        if (output !== failedOutput) return

        // Close the socket before waiting for outputLock. A write can be blocked by a full
        // Wi-Fi send buffer; closing the socket wakes it and lets the connector take over.
        val currentSocket = socket
        socket = null
        connectionReady = false
        runCatching { currentSocket?.close() }
        synchronized(outputLock) {
            if (output === failedOutput) output = null
        }
        runCatching { failedOutput.close() }
        signalConnectionChange()
        safeLog("Screen stream transport lost: ${error.safeMessage()}")
    }

    private fun closeConnectionIfCurrent(expectedSocket: Socket) {
        if (socket !== expectedSocket) return
        socket = null
        connectionReady = false
        runCatching { expectedSocket.close() }
        val currentOutput = synchronized(outputLock) {
            val value = output
            output = null
            value
        }
        runCatching { currentOutput?.close() }
        signalConnectionChange()
    }

    private fun signalConnectionChange() {
        synchronized(connectionSignal) {
            connectionSignal.notifyAll()
        }
    }

    private fun imageToBitmap(image: Image, width: Int, height: Int): Bitmap {
        val plane = image.planes.firstOrNull() ?: throw IOException("Screen image has no plane")
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        require(pixelStride > 0 && rowStride >= pixelStride * width) {
            "Screen image stride is invalid"
        }
        val paddedWidth = (rowStride + pixelStride - 1) / pixelStride
        val bitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
        plane.buffer.rewind()
        bitmap.copyPixelsFromBuffer(plane.buffer)
        if (paddedWidth == width) return bitmap

        val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
        bitmap.recycle()
        return cropped
    }

    private fun calculateDimensions(metrics: DisplayMetrics): Pair<Int, Int> {
        val sourceWidth = max(2, metrics.widthPixels)
        val sourceHeight = max(2, metrics.heightPixels)
        val scale = min(
            1f,
            min(
                offer.maxWidth.toFloat() / sourceWidth,
                offer.maxHeight.toFloat() / sourceHeight,
            ),
        )
        val width = evenDimension((sourceWidth * scale).roundToInt())
        val height = evenDimension((sourceHeight * scale).roundToInt())
        return width to height
    }

    private fun stopInternal(reason: String, stopProjection: Boolean) {
        if (!running && stoppedNotified.get()) return
        running = false
        connectionReady = false
        signalConnectionChange()

        // Close the socket before touching the output lock. A blocked writer must
        // be interrupted by the socket close rather than holding lifecycle
        // teardown hostage behind a full LAN send buffer.
        val currentSocket = socket
        socket = null
        runCatching { currentSocket?.close() }
        val currentOutput = synchronized(outputLock) {
            val value = output
            output = null
            value
        }
        runCatching { currentOutput?.close() }

        val resources = synchronized(captureLock) {
            val resources = CaptureResources(
                reader = imageReader,
                display = virtualDisplay,
                projection = projection,
                callback = projectionCallback,
                thread = captureThread,
            )
            imageReader = null
            virtualDisplay = null
            projectionCallback = null
            projection = null
            captureThread = null
            captureHandler = null
            resources
        }
        runCatching { resources.reader?.close() }
        runCatching { resources.display?.release() }
        if (resources.projection != null && resources.callback != null) {
            runCatching { resources.projection.unregisterCallback(resources.callback) }
        }
        if (stopProjection) runCatching { resources.projection?.stop() }
        resources.thread?.quitSafely()

        writer.shutdownNow()
        writeWatchdog.shutdownNow()
        frameInFlight.set(false)
        worker?.interrupt()
        if (stoppedNotified.compareAndSet(false, true)) safeStopped(reason)
    }

    private fun requirePrivateIpv4(address: InetAddress) {
        require(address is Inet4Address) { "Screen stream host must resolve to IPv4" }
        val bytes = address.address.map(Byte::toInt).map { it and 0xff }
        val carrierGradeNat = bytes[0] == 100 && bytes[1] in 64..127
        require(
            address.isSiteLocalAddress ||
                address.isLoopbackAddress ||
                address.isLinkLocalAddress ||
                carrierGradeNat,
        ) { "Screen stream host is not on a private network" }
    }

    private fun evenDimension(value: Int): Int = max(2, value and 0x7ffffffe)

    private fun safeConnecting() {
        try {
            listener.onConnecting()
        } catch (error: Exception) {
            safeLog("Connecting callback failed: ${error.safeMessage()}")
        }
    }

    private fun safeReconnecting(reason: String, attempt: Int, delayMs: Long) {
        try {
            listener.onReconnecting(reason, attempt, delayMs)
        } catch (error: Exception) {
            safeLog("Reconnect callback failed: ${error.safeMessage()}")
        }
    }

    private fun safeLog(message: String) {
        try {
            listener.onLog(message)
        } catch (_: Exception) {
            // Diagnostics must never terminate capture.
        }
    }

    private fun safeStopped(reason: String) {
        try {
            listener.onStopped(reason)
        } catch (_: Exception) {
            // Cleanup is complete; there is no recovery here.
        }
    }

    private fun Exception.safeMessage(): String =
        (message ?: "unknown error")
            .replace('\n', ' ')
            .replace('\r', ' ')
            .take(200)

    companion object {
        /** Send an authenticated terminal error while the desktop listener is still waiting for hello. */
        fun reportFailure(context: Context, offer: ScreenStreamOffer, reason: String) {
            val message = reason
                .replace('\n', ' ')
                .replace('\r', ' ')
                .take(512)
            Thread({
                runCatching {
                    val address = InetAddress.getByName(offer.host)
                    val bytes = address.address.map(Byte::toInt).map { it and 0xff }
                    val carrierGradeNat = bytes.size >= 2 && bytes[0] == 100 && bytes[1] in 64..127
                    require(
                        address is Inet4Address &&
                            (address.isSiteLocalAddress ||
                                address.isLoopbackAddress ||
                                address.isLinkLocalAddress ||
                                carrierGradeNat),
                    ) { "Screen stream host is not on a private network" }
                    val payload = ProtocolJson.encode(
                        JSONObject()
                            .put("type", "screen_error")
                            .put("protocol", 1)
                            .put("package", context.packageName)
                            .put("token", offer.token)
                            .put("generation", offer.generation)
                            .put("message", message),
                    )
                    Socket().use { errorSocket ->
                        errorSocket.tcpNoDelay = true
                        errorSocket.connect(
                            InetSocketAddress(address, offer.port),
                            REPORT_CONNECT_TIMEOUT_MS,
                        )
                        BufferedOutputStream(errorSocket.getOutputStream()).use { output ->
                            FrameCodec.writeFrame(output, payload)
                        }
                    }
                }
            }, "companion-screen-error").apply {
                isDaemon = true
                start()
            }
        }

        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val REPORT_CONNECT_TIMEOUT_MS = 2_000
        private const val FRAME_WRITE_TIMEOUT_MS = 4_000L
        private const val RECONNECT_WINDOW_MS = 120_000L
        private const val RECONNECT_INITIAL_DELAY_MS = 500L
        private const val RECONNECT_MAX_DELAY_MS = 5_000L
    }
}
