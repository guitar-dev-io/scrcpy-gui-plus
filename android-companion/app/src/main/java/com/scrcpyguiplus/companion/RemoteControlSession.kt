package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.EOFException
import java.net.Socket
import java.net.InetSocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

interface RemoteControlSessionListener {
    fun onConnected(target: RemoteTarget)
    fun onReconnecting(reason: String, attempt: Int, delayMs: Long) = Unit
    fun onDisconnected(reason: String)
    fun onLog(message: String)
}

/** Owns the controller's separate authenticated command socket. */
class RemoteControlSession(
    private val packageName: String,
    val offer: RemoteControlOffer,
    private val listener: RemoteControlSessionListener,
    private val reconnectPolicy: RemoteReconnectPolicy = RemoteReconnectPolicy(),
    private val connector: RemoteSocketConnector = DEFAULT_REMOTE_SOCKET_CONNECTOR,
    private val sleeper: RemoteSleeper = DEFAULT_REMOTE_SLEEPER,
    private val randomUnit: () -> Double = Math::random,
) {
    private val ioLock = Any()
    private val nextRequestId = AtomicLong(1)
    private val reconnectLoopRunning = AtomicBoolean(false)
    private val reconnectPending = AtomicBoolean(false)
    private val requestExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "companion-remote-request").apply { isDaemon = true }
    }

    @Volatile private var stopped = false
    @Volatile private var connected = false
    @Volatile private var socket: Socket? = null
    @Volatile private var reconnectThread: Thread? = null
    private var input: BufferedInputStream? = null
    private var output: BufferedOutputStream? = null

    val isAvailable: Boolean get() = connected && !stopped

    fun start() = scheduleReconnect("Starting remote control", immediate = true)

    /** Synchronous and bounded; a failed/uncertain request is never replayed after reconnect. */
    fun request(method: String, params: JSONObject = JSONObject()): JSONObject {
        synchronized(ioLock) {
            check(isAvailable) { "Remote control is not connected" }
            val requestId = nextRequestId.getAndIncrement()
            val activeOutput = checkNotNull(output) { "Remote control output is unavailable" }
            val activeInput = checkNotNull(input) { "Remote control input is unavailable" }
            try {
                FrameCodec.writeFrame(
                    activeOutput,
                    RemoteControlProtocol.requestFrame(requestId, method, params),
                )
                val payload = FrameCodec.readFrame(activeInput)
                    ?: throw EOFException("Desktop closed the remote control socket")
                val response = RemoteControlProtocol.parseResponse(payload, requestId)
                if (!response.ok) throw IllegalStateException(response.error ?: "Remote command failed")
                return checkNotNull(response.result)
            } catch (error: Exception) {
                connectionFailed(error.safeMessage("Remote command failed"))
                throw error
            }
        }
    }

    fun requestAsync(
        method: String,
        params: JSONObject = JSONObject(),
        callback: (Result<JSONObject>) -> Unit,
    ) {
        runCatching {
            requestExecutor.execute { callback(runCatching { request(method, params) }) }
        }.onFailure { callback(Result.failure(it)) }
    }

    fun stop(reason: String) {
        stopped = true
        requestExecutor.shutdownNow()
        reconnectThread?.interrupt()
        runCatching { socket?.close() }
        closeConnection()
        safeLog(reason)
    }

    private fun connectOnce(): Boolean {
        var activeSocket: Socket? = null
        try {
            val created = connector.create()
            activeSocket = created
            socket = created
            created.tcpNoDelay = true
            created.keepAlive = true
            created.soTimeout = RESPONSE_TIMEOUT_MS
            created.connect(InetSocketAddress(offer.host, offer.port), CONNECT_TIMEOUT_MS)
            if (stopped) return false
            val openedInput = BufferedInputStream(created.getInputStream())
            val openedOutput = BufferedOutputStream(created.getOutputStream())
            synchronized(ioLock) {
                if (stopped) return false
                input = openedInput
                output = openedOutput
                FrameCodec.writeFrame(openedOutput, RemoteControlProtocol.helloFrame(packageName, offer))
                connected = true
            }
            safeConnected()
            return true
        } catch (_: Exception) {
            if (!stopped) closeConnection()
            return false
        } finally {
            if (stopped) runCatching { activeSocket?.close() }
        }
    }

    private fun connectionFailed(reason: String) {
        closeConnection()
        if (reconnectLoopRunning.get()) {
            reconnectPending.set(true)
        } else {
            scheduleReconnect(reason, immediate = false)
        }
    }

    private fun closeConnection() {
        synchronized(ioLock) {
            connected = false
            input = null
            output = null
            val oldSocket = socket
            socket = null
            runCatching { oldSocket?.close() }
        }
    }

    private fun scheduleReconnect(reason: String, immediate: Boolean) {
        if (stopped || !reconnectLoopRunning.compareAndSet(false, true)) return
        val thread = Thread({ reconnectLoop(reason, immediate) }, "companion-remote-reconnect").apply {
            isDaemon = true
        }
        reconnectThread = thread
        thread.start()
    }

    private fun reconnectLoop(initialReason: String, immediate: Boolean) {
        val deadline = System.nanoTime() + reconnectPolicy.windowMs * NANOS_PER_MILLISECOND
        var attempt = 1
        var reason = initialReason
        var expired = false
        try {
            while (!stopped && System.nanoTime() < deadline) {
                val delay = if (immediate && attempt == 1) 0L else {
                    val retryNumber = (attempt - 1).coerceAtLeast(1)
                    minOf(
                        reconnectPolicy.delayMs(retryNumber, randomUnit()),
                        remainingMillis(deadline),
                    )
                }
                if (delay > 0) {
                    safeReconnecting(reason, (attempt - 1).coerceAtLeast(1), delay)
                    sleeper.sleep(delay)
                }
                if (stopped) return
                if (System.nanoTime() >= deadline) break
                if (connectOnce()) return
                reason = "Remote control connection failed"
                attempt += 1
            }
            expired = !stopped
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            reconnectThread = null
            reconnectLoopRunning.set(false)
            if (expired) safeDisconnected("Remote control reconnect window expired")
            if (!stopped && !expired && reconnectPending.getAndSet(false) && !connected) {
                scheduleReconnect(reason, immediate = false)
            }
        }
    }

    private fun safeConnected() = runCatching { listener.onConnected(offer.target) }
        .onFailure { safeLog("Remote connected callback failed: ${it.message ?: "unknown error"}") }

    private fun safeReconnecting(reason: String, attempt: Int, delayMs: Long) =
        runCatching { listener.onReconnecting(reason, attempt, delayMs) }
            .onFailure { safeLog("Remote reconnect callback failed: ${it.message ?: "unknown error"}") }

    private fun safeDisconnected(reason: String) = runCatching { listener.onDisconnected(reason) }
        .onFailure { safeLog("Remote disconnected callback failed: ${it.message ?: "unknown error"}") }

    private fun safeLog(message: String) { runCatching { listener.onLog(message) } }

    private fun Exception.safeMessage(fallback: String = "unknown error"): String =
        (message ?: fallback).replace('\n', ' ').replace('\r', ' ').take(200)

    private fun remainingMillis(deadlineNanos: Long): Long =
        ((deadlineNanos - System.nanoTime()) / NANOS_PER_MILLISECOND).coerceAtLeast(0)

    private companion object {
        const val CONNECT_TIMEOUT_MS = 5_000
        const val RESPONSE_TIMEOUT_MS = 5_000
        const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
