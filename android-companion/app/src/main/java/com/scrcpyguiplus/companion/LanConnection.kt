package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Owns one authenticated private-LAN stream and runs protocol I/O off the main thread.
 *
 * The QR offer is the session identity, not a one-shot socket. Once a connection drops, this
 * worker closes the broken socket and retries the same offer with bounded exponential backoff.
 */
class LanConnection(
    private val offer: LanPairingOffer,
    private val helloPayload: ByteArray,
    requestHandler: (ByteArray) -> PreparedResponse,
    private val listener: CompanionSessionListener,
) : CompanionSession {
    override val transport: String = "lan-tcp"

    @Volatile
    private var stopRequested = false

    @Volatile
    private var stopReason = "Stopped by the app"

    @Volatile
    private var worker: Thread? = null

    @Volatile
    private var socket: Socket? = null

    private val resilientRequestHandler = ResilientRequestHandler(
        delegate = requestHandler,
        failureLogger = ::safeLog,
    )

    @Synchronized
    override fun start() {
        if (worker != null || stopRequested) return
        worker = Thread(::runConnection, "companion-lan-io").apply {
            isDaemon = true
            start()
        }
    }

    override fun stop(reason: String) {
        stopReason = reason
        stopRequested = true
        runCatching { socket?.close() }
        worker?.interrupt()
    }

    private fun runConnection() {
        var disconnectReason = "Desktop closed the LAN connection"
        var reconnectAttempt = 0

        while (!stopRequested) {
            var activeSocket: Socket? = null
            try {
                val address = InetAddress.getByName(offer.host)
                requirePrivateIpv4(address)

                if (reconnectAttempt > 0) {
                    val delayMs = reconnectDelayMs(reconnectAttempt)
                    safeReconnecting(
                        "Retrying the LAN companion socket in ${delayMs}ms",
                        reconnectAttempt,
                        delayMs,
                    )
                    if (!sleepBeforeReconnect(delayMs)) break
                }

                val connectedSocket = Socket()
                activeSocket = connectedSocket
                socket = connectedSocket
                connectedSocket.tcpNoDelay = true
                connectedSocket.keepAlive = true
                connectedSocket.connect(InetSocketAddress(address, offer.port), CONNECT_TIMEOUT_MS)

                val input = BufferedInputStream(connectedSocket.getInputStream())
                val output = BufferedOutputStream(connectedSocket.getOutputStream())
                FrameCodec.writeFrame(output, helloPayload)
                safeConnected()
                reconnectAttempt = 0

                while (!stopRequested) {
                    val payload = FrameCodec.readFrame(input)
                        ?: throw EOFException("Desktop closed the LAN connection")
                    val response = resilientRequestHandler.handle(payload)
                    FrameCodec.writeFrame(output, response.payload)
                    runAfterWrite(response.afterWrite)
                }
                if (stopRequested) disconnectReason = stopReason
            } catch (error: FrameProtocolException) {
                disconnectReason = "Protocol framing error: ${error.safeMessage()}"
            } catch (error: EOFException) {
                disconnectReason = "LAN connection closed during a frame"
            } catch (error: IOException) {
                disconnectReason = if (stopRequested) {
                    stopReason
                } else {
                    "LAN connection failed: ${error.safeMessage("I/O error")}"
                }
            } catch (error: Exception) {
                disconnectReason = if (stopRequested) {
                    stopReason
                } else {
                    "LAN session stopped: ${error.safeMessage()}"
                }
            } finally {
                runCatching { activeSocket?.close() }
                if (socket === activeSocket) socket = null
            }

            if (stopRequested) break
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(MAX_RECONNECT_ATTEMPT)
        }

        if (stopRequested) disconnectReason = stopReason
        safeDisconnected(disconnectReason)
    }

    private fun sleepBeforeReconnect(delayMs: Long): Boolean {
        var remaining = delayMs
        while (!stopRequested && remaining > 0) {
            val slice = minOf(remaining, RECONNECT_SLEEP_SLICE_MS)
            try {
                Thread.sleep(slice)
            } catch (_: InterruptedException) {
                if (stopRequested) return false
            }
            remaining -= slice
        }
        return !stopRequested
    }

    private fun reconnectDelayMs(attempt: Int): Long {
        val exponent = (attempt - 1).coerceIn(0, 6)
        return minOf(MAX_RECONNECT_DELAY_MS, INITIAL_RECONNECT_DELAY_MS * (1L shl exponent))
    }

    private fun requirePrivateIpv4(address: InetAddress) {
        require(address is Inet4Address) { "Pairing host must resolve to IPv4" }
        val bytes = address.address.map(Byte::toInt).map { it and 0xff }
        val carrierGradeNat = bytes[0] == 100 && bytes[1] in 64..127
        require(
            address.isSiteLocalAddress ||
                address.isLoopbackAddress ||
                address.isLinkLocalAddress ||
                carrierGradeNat,
        ) { "Pairing host is not on a private network" }
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
            // UI diagnostics must never terminate the network worker.
        }
    }

    private fun safeDisconnected(reason: String) {
        try {
            listener.onDisconnected(reason)
        } catch (_: Exception) {
            // Cleanup is complete; there is no useful recovery here.
        }
    }

    private fun Exception.safeMessage(fallback: String = "unknown error"): String =
        (message ?: fallback)
            .replace('\n', ' ')
            .replace('\r', ' ')
            .take(200)

    private companion object {
        const val CONNECT_TIMEOUT_MS = 5_000
        const val INITIAL_RECONNECT_DELAY_MS = 250L
        const val MAX_RECONNECT_DELAY_MS = 10_000L
        const val MAX_RECONNECT_ATTEMPT = 1_000
        const val RECONNECT_SLEEP_SLICE_MS = 250L
    }
}
