package com.scrcpyguiplus.companion

import android.os.ParcelFileDescriptor
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

interface CompanionSession {
    val transport: String
    fun start()
    fun stop(reason: String = "Stopped by the app")
}

interface CompanionSessionListener {
    fun onConnected()
    fun onReconnecting(reason: String, attempt: Int, delayMs: Long) {}
    fun onLog(message: String)
    fun onDisconnected(reason: String)
}

/** Owns one opened UsbAccessory stream and keeps all blocking I/O off the main thread. */
class AccessoryConnection(
    private val descriptor: ParcelFileDescriptor,
    private val helloPayload: ByteArray,
    requestHandler: (ByteArray) -> PreparedResponse,
    private val listener: CompanionSessionListener,
) : CompanionSession {
    override val transport: String = "usb-accessory"

    @Volatile
    private var stopRequested = false

    @Volatile
    private var stopReason = "Stopped by the app"

    @Volatile
    private var worker: Thread? = null

    private val resilientRequestHandler = ResilientRequestHandler(
        delegate = requestHandler,
        failureLogger = ::safeLog,
    )

    @Synchronized
    override fun start() {
        if (worker != null || stopRequested) return
        worker = Thread(::runConnection, "AOA-accessory-io").apply {
            isDaemon = true
            start()
        }
    }

    override fun stop(reason: String) {
        stopReason = reason
        stopRequested = true
        // Closing the descriptor unblocks a read on Android implementations that do not respond
        // to Thread.interrupt() while the USB file descriptor is blocked.
        runCatching { descriptor.close() }
        worker?.interrupt()
    }

    private fun runConnection() {
        var input: FileInputStream? = null
        var output: BufferedOutputStream? = null
        var disconnectReason = "Host closed the accessory stream"
        try {
            val inputStream = FileInputStream(descriptor.fileDescriptor)
            val outputStream = BufferedOutputStream(FileOutputStream(descriptor.fileDescriptor))
            input = inputStream
            output = outputStream

            // The hello frame is the first application bytes written after opening the accessory.
            FrameCodec.writeFrame(outputStream, helloPayload)
            safeConnected()

            while (!stopRequested) {
                val payload = FrameCodec.readFrame(inputStream) ?: break
                val response = resilientRequestHandler.handle(payload)
                FrameCodec.writeFrame(outputStream, response.payload)
                runAfterWrite(response.afterWrite)
            }
            if (stopRequested) disconnectReason = stopReason
        } catch (error: FrameProtocolException) {
            disconnectReason = "Protocol framing error: ${error.safeMessage()}"
        } catch (error: EOFException) {
            disconnectReason = "Accessory disconnected during a frame"
        } catch (error: IOException) {
            disconnectReason = if (stopRequested) {
                stopReason
            } else {
                "Accessory I/O stopped: ${error.safeMessage("I/O error")}"
            }
        } catch (error: Exception) {
            disconnectReason = if (stopRequested) {
                stopReason
            } else {
                "Accessory session stopped: ${error.safeMessage()}"
            }
        } finally {
            runCatching { output?.close() }
            runCatching { input?.close() }
            runCatching { descriptor.close() }
            safeDisconnected(disconnectReason)
        }
    }

    private fun runAfterWrite(action: (() -> Unit)?) {
        if (action == null) return
        try {
            action()
        } catch (error: Exception) {
            safeLog("Post-response action failed: ${error.safeMessage()}")
        }
    }

    private fun safeConnected() {
        try {
            listener.onConnected()
        } catch (error: Exception) {
            safeLog("Connected callback failed: ${error.safeMessage()}")
        }
    }

    private fun safeLog(message: String) {
        try {
            listener.onLog(message)
        } catch (_: Exception) {
            // UI diagnostics must never terminate the USB worker.
        }
    }

    private fun safeDisconnected(reason: String) {
        try {
            listener.onDisconnected(reason)
        } catch (_: Exception) {
            // Cleanup is complete; there is no useful recovery if a diagnostic callback fails.
        }
    }

    private fun Exception.safeMessage(fallback: String = "unknown error"): String =
        (message ?: fallback)
            .replace('\n', ' ')
            .replace('\r', ' ')
            .take(200)
}
