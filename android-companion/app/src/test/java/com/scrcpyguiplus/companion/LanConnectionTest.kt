package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanConnectionTest {
    @Test
    fun retriesTheSamePairingOfferAfterTheDesktopSocketCloses() {
        val token = "ab".repeat(32)
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val acceptedConnections = CountDownLatch(2)
        val disconnected = CountDownLatch(1)
        val reconnectAttempts = AtomicInteger(0)
        val serverFailure = AtomicReference<Throwable?>(null)
        val offer = LanPairingOffer("127.0.0.1", server.localPort, token)
        val hello = ProtocolJson.helloFrame(
            appName = "Companion",
            packageName = "com.scrcpyguiplus.companion",
            version = "test",
            pairingToken = token,
        )

        val serverThread = Thread({
            try {
                server.use { listener ->
                    repeat(2) {
                        listener.accept().use { socket ->
                            assertTrue(FrameCodec.readFrame(BufferedInputStream(socket.getInputStream()))!!.isNotEmpty())
                            acceptedConnections.countDown()
                            if (it == 1) Thread.sleep(1_000)
                        }
                    }
                }
            } catch (error: Throwable) {
                serverFailure.set(error)
            }
        }, "lan-connection-test-server").apply {
            isDaemon = true
            start()
        }

        lateinit var connection: LanConnection
        connection = LanConnection(
            offer = offer,
            helloPayload = hello,
            requestHandler = { error("No request should be sent by the test server") },
            listener = object : CompanionSessionListener {
                override fun onConnected() = Unit

                override fun onReconnecting(reason: String, attempt: Int, delayMs: Long) {
                    reconnectAttempts.incrementAndGet()
                }

                override fun onLog(message: String) = Unit

                override fun onDisconnected(reason: String) {
                    disconnected.countDown()
                }
            },
        )
        connection.start()

        assertTrue(acceptedConnections.await(5, TimeUnit.SECONDS))
        connection.stop("test complete")
        assertTrue(disconnected.await(5, TimeUnit.SECONDS))
        serverThread.join(2_000)
        assertEquals(null, serverFailure.get())
        assertTrue("expected a reconnect callback", reconnectAttempts.get() > 0)
    }

    @Test
    fun skipsCandidateAddressesItCannotUseAndConnectsToTheNextOne() {
        val token = "ab".repeat(32)
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val connected = CountDownLatch(1)
        val helloReceived = CountDownLatch(1)
        val logs = Collections.synchronizedList(mutableListOf<String>())
        // A desktop advertises every address it might be reachable on, and some of them
        // are unusable from here. The session has to walk past those instead of stopping
        // at the first entry, which is what made a single wrong QR host fatal before.
        val offer = LanPairingOffer(
            host = "8.8.8.8",
            port = server.localPort,
            token = token,
            hosts = listOf("8.8.8.8", "not-an-address", "127.0.0.1"),
        )

        val serverThread = Thread({
            runCatching {
                server.use { listener ->
                    listener.accept().use { socket ->
                        FrameCodec.readFrame(BufferedInputStream(socket.getInputStream()))
                        helloReceived.countDown()
                        Thread.sleep(500)
                    }
                }
            }
        }, "lan-multi-host-test-server").apply {
            isDaemon = true
            start()
        }

        val connection = LanConnection(
            offer = offer,
            helloPayload = ProtocolJson.helloFrame(
                appName = "Companion",
                packageName = "com.scrcpyguiplus.companion",
                version = "test",
                pairingToken = token,
            ),
            requestHandler = { error("No request should be sent by the test server") },
            listener = object : CompanionSessionListener {
                override fun onConnected() {
                    connected.countDown()
                }

                override fun onLog(message: String) {
                    logs.add(message)
                }

                override fun onDisconnected(reason: String) = Unit
            },
        )
        connection.start()

        assertTrue(helloReceived.await(5, TimeUnit.SECONDS))
        assertTrue("expected the loopback candidate to be reached", connected.await(5, TimeUnit.SECONDS))
        connection.stop("test complete")
        serverThread.join(2_000)

        val skipped = logs.filter { entry -> entry.contains("8.8.8.8") || entry.contains("not-an-address") }
        assertTrue("expected the unusable candidates to be reported: $logs", skipped.size >= 2)
    }

    @Test
    fun reportsEveryAddressItTriedWhenNoneOfThemAnswer() {
        val disconnected = CountDownLatch(1)
        val disconnectReason = AtomicReference<String?>(null)
        // Public addresses are refused before a socket is opened, so this stays fast while
        // still exercising the "every candidate failed" path.
        val offer = LanPairingOffer(
            host = "8.8.8.8",
            port = 44_100,
            token = "ab".repeat(32),
            hosts = listOf("8.8.8.8", "1.1.1.1"),
        )

        val connection = LanConnection(
            offer = offer,
            helloPayload = ProtocolJson.helloFrame(
                appName = "Companion",
                packageName = "com.scrcpyguiplus.companion",
                version = "test",
                pairingToken = "ab".repeat(32),
            ),
            requestHandler = { error("No request is expected") },
            listener = object : CompanionSessionListener {
                override fun onConnected() = error("No candidate should have answered")

                override fun onLog(message: String) = Unit

                override fun onDisconnected(reason: String) {
                    disconnectReason.set(reason)
                    disconnected.countDown()
                }
            },
        )
        connection.start()
        // The worker retries with backoff, so stop it once the first attempt has failed.
        Thread.sleep(500)
        connection.stop("test complete")

        assertTrue(disconnected.await(5, TimeUnit.SECONDS))
        assertEquals("test complete", disconnectReason.get())
    }

    @Test
    fun anApprovalOfferWaitsForTheDesktopBeforeCallingItselfConnected() {
        val nonce = LanPairing.newApprovalNonce()
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val awaitingCode = AtomicReference<String?>(null)
        val awaiting = CountDownLatch(1)
        val connected = CountDownLatch(1)
        val helloFields = AtomicReference<JSONObject?>(null)
        val offer = LanPairingOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "",
            studioName = "Desk",
            hosts = listOf("127.0.0.1"),
            approvalNonce = nonce,
        )

        val serverThread = Thread({
            runCatching {
                server.use { listener ->
                    listener.accept().use { socket ->
                        val input = BufferedInputStream(socket.getInputStream())
                        val hello = FrameCodec.readFrame(input)!!
                        helloFields.set(JSONObject(String(hello, StandardCharsets.UTF_8)))
                        // Stand in for the desktop user taking a moment to approve.
                        Thread.sleep(600)
                        FrameCodec.writeFrame(socket.getOutputStream(), "{\"type\":\"request\"}".toByteArray())
                        FrameCodec.readFrame(input)
                    }
                }
            }
        }, "lan-approval-test-server").apply {
            isDaemon = true
            start()
        }

        val connection = LanConnection(
            offer = offer,
            helloPayload = ProtocolJson.helloFrame(
                appName = "Companion",
                packageName = "com.scrcpyguiplus.companion",
                version = "test",
                pairingToken = offer.token,
                approvalNonce = offer.approvalNonce,
            ),
            requestHandler = { PreparedResponse("{}".toByteArray()) },
            listener = object : CompanionSessionListener {
                override fun onConnected() {
                    connected.countDown()
                }

                override fun onAwaitingApproval(code: String?) {
                    awaitingCode.set(code)
                    awaiting.countDown()
                }

                override fun onLog(message: String) = Unit

                override fun onDisconnected(reason: String) = Unit
            },
        )
        connection.start()

        assertTrue("expected an approval-pending callback", awaiting.await(5, TimeUnit.SECONDS))
        assertEquals(LanPairing.approvalCode(nonce), awaitingCode.get())
        // An open socket is not yet a session: the desktop has said nothing at this point.
        assertEquals(1, connected.count)

        assertTrue("expected connected once the desktop spoke", connected.await(5, TimeUnit.SECONDS))
        connection.stop("test complete")
        serverThread.join(2_000)

        val hello = helloFields.get()
        requireNotNull(hello)
        assertEquals(nonce, hello.getString("nonce"))
        // Sending an empty token would be read as a wrong token and rejected outright.
        assertFalse("a token-less hello must omit the field", hello.has("token"))
    }

    @Test
    fun anUnapprovedOfferStopsInsteadOfReconnectingForever() {
        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        val accepted = AtomicInteger(0)
        val disconnected = CountDownLatch(1)
        val giveUpReason = AtomicReference<String?>(null)
        val offer = LanPairingOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "",
            hosts = listOf("127.0.0.1"),
            approvalNonce = LanPairing.newApprovalNonce(),
        )

        // A desktop that rejects closes the socket without ever sending a request. Retrying
        // that would raise a fresh approval prompt on every attempt, so the session has to
        // give up and let the user start it again.
        val serverThread = Thread({
            runCatching {
                server.use { listener ->
                    while (true) {
                        val socket = listener.accept()
                        FrameCodec.readFrame(BufferedInputStream(socket.getInputStream()))
                        accepted.incrementAndGet()
                        socket.close()
                    }
                }
            }
        }, "lan-rejection-test-server").apply {
            isDaemon = true
            start()
        }

        val connection = LanConnection(
            offer = offer,
            helloPayload = ProtocolJson.helloFrame(
                appName = "Companion",
                packageName = "com.scrcpyguiplus.companion",
                version = "test",
                pairingToken = offer.token,
                approvalNonce = offer.approvalNonce,
            ),
            requestHandler = { PreparedResponse("{}".toByteArray()) },
            listener = object : CompanionSessionListener {
                override fun onConnected() = error("The desktop never approved this device")

                override fun onAwaitingApproval(code: String?) = Unit

                override fun onLog(message: String) = Unit

                override fun onDisconnected(reason: String) {
                    giveUpReason.set(reason)
                    disconnected.countDown()
                }
            },
        )
        connection.start()

        assertTrue("expected the session to give up", disconnected.await(5, TimeUnit.SECONDS))
        assertTrue(
            "expected a rejection message, got ${giveUpReason.get()}",
            giveUpReason.get()?.contains("did not approve") == true,
        )
        connection.stop("test complete")
        serverThread.interrupt()
        // Exactly one attempt: a retry would have produced a second accept.
        assertEquals(1, accepted.get())
    }
}
