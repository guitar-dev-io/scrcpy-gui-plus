package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
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
}
