package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.Socket
import java.net.InetSocketAddress

interface RemoteVideoSessionListener {
    fun onVideoConnected()
    fun onVideoReconnecting(reason: String, attempt: Int, delayMs: Long) = Unit
    fun onVideoMessage(message: RemoteVideoMessage)
    fun onVideoDisconnected(reason: String)
}

/** Owns one read-only video connection loop; a stopped/replaced session is never revived. */
class RemoteVideoSession(
    private val packageName: String,
    private val offer: RemoteControlOffer,
    private val listener: RemoteVideoSessionListener,
    private val reconnectPolicy: RemoteReconnectPolicy = RemoteReconnectPolicy(),
    private val connector: RemoteSocketConnector = DEFAULT_REMOTE_SOCKET_CONNECTOR,
    private val sleeper: RemoteSleeper = DEFAULT_REMOTE_SLEEPER,
    private val randomUnit: () -> Double = Math::random,
) {
    @Volatile private var stopped = false
    @Volatile private var socket: Socket? = null
    @Volatile private var worker: Thread? = null

    fun start() {
        if (worker != null || stopped) return
        worker = Thread(::runLoop, "companion-remote-video").apply { isDaemon = true; start() }
    }

    fun stop() {
        stopped = true
        worker?.interrupt()
        runCatching { socket?.close() }
        socket = null
    }

    private fun runLoop() {
        var attempt = 1
        var reason = "Starting remote target video"
        var deadline = System.nanoTime() + reconnectPolicy.windowMs * NANOS_PER_MILLISECOND
        try {
            while (!stopped && System.nanoTime() < deadline) {
                if (attempt > 1) {
                    val delay = minOf(
                        reconnectPolicy.delayMs(attempt - 1, randomUnit()),
                        remainingMillis(deadline),
                    )
                    listener.onVideoReconnecting(reason, attempt - 1, delay)
                    sleeper.sleep(delay)
                    if (stopped) return
                    if (System.nanoTime() >= deadline) break
                }
                val result = connectAndRead()
                reason = result.reason
                if (result.wasConnected) {
                    // A live channel gets a fresh server-aligned reconnect window when it drops.
                    deadline = System.nanoTime() + reconnectPolicy.windowMs * NANOS_PER_MILLISECOND
                    attempt = 2
                } else {
                    attempt += 1
                }
            }
            if (!stopped) listener.onVideoDisconnected("Remote video reconnect window expired")
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            runCatching { socket?.close() }
            socket = null
            worker = null
        }
    }

    private fun connectAndRead(): ConnectionResult {
        var connected = false
        return try {
            val created = connector.create().also { socket = it }
            created.tcpNoDelay = true
            created.keepAlive = true
            // A static scrcpy screen may send no packets; stop() closes this blocking read.
            created.soTimeout = 0
            created.connect(InetSocketAddress(offer.host, offer.port), CONNECT_TIMEOUT_MS)
            if (stopped) return ConnectionResult(false, "Remote video stopped")
            val input = BufferedInputStream(created.getInputStream())
            val output = BufferedOutputStream(created.getOutputStream())
            FrameCodec.writeFrame(output, RemoteControlProtocol.videoHelloFrame(packageName, offer))
            connected = true
            listener.onVideoConnected()
            while (!stopped) {
                val payload = FrameCodec.readFrame(input, RemoteVideoProtocol.MAX_VIDEO_FRAME_BYTES)
                    ?: break
                listener.onVideoMessage(RemoteVideoProtocol.parse(payload))
            }
            ConnectionResult(connected, "Desktop closed the video socket")
        } catch (error: Exception) {
            ConnectionResult(
                connected,
                (error.message ?: "video connection failed")
                    .replace('\n', ' ').replace('\r', ' ').take(200),
            )
        } finally {
            runCatching { socket?.close() }
            socket = null
        }
    }

    private data class ConnectionResult(val wasConnected: Boolean, val reason: String)

    private fun remainingMillis(deadlineNanos: Long): Long =
        ((deadlineNanos - System.nanoTime()) / NANOS_PER_MILLISECOND).coerceAtLeast(0)

    private companion object {
        const val CONNECT_TIMEOUT_MS = 5_000
        const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
