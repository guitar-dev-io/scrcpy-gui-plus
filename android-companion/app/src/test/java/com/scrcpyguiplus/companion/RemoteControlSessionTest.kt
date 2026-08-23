package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetAddress
import java.net.ConnectException
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class RemoteControlSessionTest {
    @Test
    fun authenticatesAndPerformsBoundedCorrelatedRequest() {
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val connected = CountDownLatch(1)
        val serverFailure = AtomicReference<Throwable?>(null)
        val offer = RemoteControlOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "ab".repeat(32),
            generation = 4,
            sessionId = "session_test",
            target = RemoteTarget("serial", "Test phone"),
        )
        val serverThread = Thread({
            try {
                server.use { listener ->
                    listener.accept().use { socket ->
                        val input = BufferedInputStream(socket.getInputStream())
                        val output = BufferedOutputStream(socket.getOutputStream())
                        val hello = JSONObject(String(FrameCodec.readFrame(input)!!, StandardCharsets.UTF_8))
                        assertEquals("remote_hello", hello.getString("type"))
                        assertEquals(offer.sessionId, hello.getString("sessionId"))

                        val request = JSONObject(String(FrameCodec.readFrame(input)!!, StandardCharsets.UTF_8))
                        assertEquals("remote_request", request.getString("type"))
                        assertEquals("back", request.getString("method"))
                        FrameCodec.writeFrame(
                            output,
                            JSONObject()
                                .put("type", "remote_response")
                                .put("id", request.getLong("id"))
                                .put("ok", true)
                                .put("result", JSONObject().put("accepted", true))
                                .put("error", JSONObject.NULL)
                                .toString()
                                .toByteArray(StandardCharsets.UTF_8),
                        )
                    }
                }
            } catch (error: Throwable) {
                serverFailure.set(error)
            }
        }, "remote-control-test-server").apply { start() }

        val session = RemoteControlSession(
            packageName = "example.package",
            offer = offer,
            listener = object : RemoteControlSessionListener {
                override fun onConnected(target: RemoteTarget) {
                    connected.countDown()
                }

                override fun onDisconnected(reason: String) = Unit
                override fun onLog(message: String) = Unit
            },
        )
        session.start()
        assertTrue(connected.await(3, TimeUnit.SECONDS))
        assertTrue(session.request("back").getBoolean("accepted"))
        session.stop("test complete")
        serverThread.join(3_000)
        assertEquals(null, serverFailure.get())
    }

    @Test
    fun reconnectsWithoutReplayingAnUncertainRequest() {
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val connectedTwice = CountDownLatch(2)
        val serverDone = CountDownLatch(1)
        val serverFailure = AtomicReference<Throwable?>(null)
        val offer = RemoteControlOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "ab".repeat(32),
            generation = 5,
            sessionId = "session_reconnect",
            target = RemoteTarget("serial", "Test phone"),
        )
        Thread({
            try {
                server.use { listener ->
                    listener.accept().use { first ->
                        val firstInput = BufferedInputStream(first.getInputStream())
                        FrameCodec.readFrame(firstInput) // hello
                        val request = JSONObject(String(FrameCodec.readFrame(firstInput)!!, StandardCharsets.UTF_8))
                        assertEquals("text", request.getString("method"))
                        // Close after receipt but before response: client must not know whether it ran.
                    }
                    listener.accept().use { second ->
                        second.soTimeout = 300
                        val secondInput = BufferedInputStream(second.getInputStream())
                        val hello = JSONObject(String(FrameCodec.readFrame(secondInput)!!, StandardCharsets.UTF_8))
                        assertEquals(offer.sessionId, hello.getString("sessionId"))
                        assertThrows(SocketTimeoutException::class.java) {
                            FrameCodec.readFrame(secondInput)
                        }
                    }
                }
            } catch (error: Throwable) {
                serverFailure.set(error)
            } finally {
                serverDone.countDown()
            }
        }, "remote-reconnect-test-server").apply { start() }

        val session = RemoteControlSession(
            packageName = "example.package",
            offer = offer,
            reconnectPolicy = RemoteReconnectPolicy(10, 10, 2_000, 0.0),
            randomUnit = { 0.5 },
            listener = object : RemoteControlSessionListener {
                override fun onConnected(target: RemoteTarget) { connectedTwice.countDown() }
                override fun onDisconnected(reason: String) = Unit
                override fun onLog(message: String) = Unit
            },
        )
        session.start()
        while (connectedTwice.count == 2L) Thread.sleep(5)
        assertThrows(Exception::class.java) {
            session.request("text", JSONObject().put("text", "do not replay"))
        }
        assertTrue(connectedTwice.await(3, TimeUnit.SECONDS))
        assertTrue(serverDone.await(3, TimeUnit.SECONDS))
        session.stop("test complete")
        assertEquals(null, serverFailure.get())
    }

    @Test
    fun explicitStopInterruptsBackoffAndPreventsAnotherConnectLoop() {
        val sleeping = CountDownLatch(1)
        val sleepExited = CountDownLatch(1)
        val connectCalls = AtomicInteger(0)
        val disconnected = AtomicBoolean(false)
        val session = RemoteControlSession(
            packageName = "example.package",
            offer = RemoteControlOffer(
                "127.0.0.1",
                12345,
                "ab".repeat(32),
                6,
                "session_stop",
                RemoteTarget("serial", "Target"),
            ),
            reconnectPolicy = RemoteReconnectPolicy(10_000, 10_000, 120_000, 0.0),
            connector = RemoteSocketConnector {
                connectCalls.incrementAndGet()
                FailingConnectSocket()
            },
            sleeper = RemoteSleeper { delay ->
                sleeping.countDown()
                try {
                    Thread.sleep(delay)
                } finally {
                    sleepExited.countDown()
                }
            },
            listener = object : RemoteControlSessionListener {
                override fun onConnected(target: RemoteTarget) = Unit
                override fun onDisconnected(reason: String) { disconnected.set(true) }
                override fun onLog(message: String) = Unit
            },
        )
        session.start()
        assertTrue(sleeping.await(2, TimeUnit.SECONDS))
        session.stop("Activity stopped")
        assertTrue(sleepExited.await(2, TimeUnit.SECONDS))
        Thread.sleep(30)
        assertEquals(1, connectCalls.get())
        assertFalse(disconnected.get())
        assertFalse(session.isAvailable)
    }

    private class FailingConnectSocket : Socket() {
        override fun connect(endpoint: SocketAddress?, timeout: Int) {
            throw ConnectException("expected test failure")
        }
    }
}
