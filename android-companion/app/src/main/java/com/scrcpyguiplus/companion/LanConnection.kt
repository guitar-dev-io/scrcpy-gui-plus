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
 * The offer is the session identity, not a one-shot socket. Once a connection drops, this
 * worker closes the broken socket and retries the same offer with bounded exponential backoff.
 *
 * The offer names several candidate addresses, not one: a desktop on more than one network
 * cannot know which of its addresses this phone can see, so every candidate is dialed in turn
 * and the one that answered is remembered for later retries.
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

    /** The candidate that last answered, tried first on every later attempt. */
    @Volatile
    private var lastGoodHost: String? = null

    /**
     * Whether this offer has ever been let through by the desktop. Retrying is right once
     * it has (a Wi-Fi blip should heal itself), and wrong before: an unapproved socket that
     * reconnects raises the approval prompt again, over and over.
     */
    @Volatile
    private var everApproved = false

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
                if (reconnectAttempt > 0) {
                    val delayMs = reconnectDelayMs(reconnectAttempt)
                    safeReconnecting(
                        "Retrying the LAN companion socket in ${delayMs}ms",
                        reconnectAttempt,
                        delayMs,
                    )
                    if (!sleepBeforeReconnect(delayMs)) break
                }

                val connectedSocket = connectToAnyCandidate()
                activeSocket = connectedSocket
                socket = connectedSocket

                val input = BufferedInputStream(connectedSocket.getInputStream())
                val output = BufferedOutputStream(connectedSocket.getOutputStream())
                FrameCodec.writeFrame(output, helloPayload)

                // Without a token the desktop deliberately sends nothing until its user
                // approves this device, so an open socket does not yet mean a session.
                // Reporting "connected" only once the first request arrives keeps the UI
                // honest about which of the two states it is in.
                var announcedConnected = false
                if (!offer.requiresApproval) {
                    safeConnected()
                    announcedConnected = true
                } else {
                    safeAwaitingApproval(offer.approvalCode)
                }
                reconnectAttempt = 0

                while (!stopRequested) {
                    val payload = FrameCodec.readFrame(input)
                        ?: throw EOFException("Desktop closed the LAN connection")
                    if (!announcedConnected) {
                        announcedConnected = true
                        everApproved = true
                        safeConnected()
                    }
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
            if (offer.requiresApproval && !everApproved) {
                // The desktop closed the socket without ever sending a request, which means
                // it answered: rejected, or nobody answered in time. Reconnecting would just
                // put another prompt on their screen, so surface it and let the user retry.
                disconnectReason =
                    "The desktop did not approve this device. Pick the studio again to retry."
                break
            }
            reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(MAX_RECONNECT_ATTEMPT)
        }

        if (stopRequested) disconnectReason = stopReason
        safeDisconnected(disconnectReason)
    }

    /**
     * Dial each candidate address until one accepts, starting from whichever answered
     * last. Throws the final failure if none of them do.
     */
    private fun connectToAnyCandidate(): Socket {
        val candidates = orderedCandidates()
        var lastError: Exception? = null

        for ((index, host) in candidates.withIndex()) {
            if (stopRequested) throw IOException(stopReason)
            val address = try {
                InetAddress.getByName(host).also(::requirePrivateIpv4)
            } catch (error: Exception) {
                lastError = error
                safeLog("Skipping pairing address $host: ${error.safeMessage("unusable address")}")
                continue
            }
            val candidateSocket = Socket()
            try {
                candidateSocket.tcpNoDelay = true
                candidateSocket.keepAlive = true
                // A reachable host on the same network answers in milliseconds, so give the
                // earlier candidates a short budget: waiting the full timeout on each one
                // would make a list of addresses slower than the single address it replaces.
                val timeoutMs = if (index == candidates.lastIndex) {
                    CONNECT_TIMEOUT_MS
                } else {
                    CANDIDATE_PROBE_TIMEOUT_MS
                }
                candidateSocket.connect(InetSocketAddress(address, offer.port), timeoutMs)
                lastGoodHost = host
                if (candidates.size > 1) {
                    safeLog("Reached the desktop at $host:${offer.port}")
                }
                return candidateSocket
            } catch (error: Exception) {
                runCatching { candidateSocket.close() }
                lastError = error
                safeLog(
                    "Could not reach $host:${offer.port}: ${error.safeMessage("connect failed")}",
                )
            }
        }

        throw IOException(
            "None of the desktop addresses (${candidates.joinToString(", ")}) could be reached " +
                "on port ${offer.port}",
            lastError,
        )
    }

    private fun orderedCandidates(): List<String> {
        val candidates = offer.hosts.ifEmpty { listOf(offer.host) }
        val preferred = lastGoodHost
        return if (preferred != null && candidates.contains(preferred)) {
            listOf(preferred) + candidates.filter { host -> host != preferred }
        } else {
            candidates
        }
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

    private fun safeAwaitingApproval(code: String?) {
        try {
            listener.onAwaitingApproval(code)
        } catch (error: Exception) {
            safeLog("Approval callback failed: ${error.safeMessage()}")
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
        const val CANDIDATE_PROBE_TIMEOUT_MS = 1_200
        const val INITIAL_RECONNECT_DELAY_MS = 250L
        const val MAX_RECONNECT_DELAY_MS = 10_000L
        const val MAX_RECONNECT_ATTEMPT = 1_000
        const val RECONNECT_SLEEP_SLICE_MS = 250L
    }
}
