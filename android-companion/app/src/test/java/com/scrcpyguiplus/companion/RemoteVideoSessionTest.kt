package com.scrcpyguiplus.companion

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetAddress
import java.net.ConnectException
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
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
import org.junit.Test

class RemoteVideoSessionTest {
    @Test
    fun authenticatesDedicatedVideoChannelAndReadsBinaryMessage() {
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val received = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>(null)
        val offer = RemoteControlOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "ab".repeat(32),
            generation = 8,
            sessionId = "session_video",
            target = RemoteTarget("serial", "Target"),
            permissions = setOf("view"),
        )
        val serverThread = Thread {
            try {
                server.use { listener ->
                    listener.accept().use { socket ->
                        val input = BufferedInputStream(socket.getInputStream())
                        val output = BufferedOutputStream(socket.getOutputStream())
                        val hello = JSONObject(String(FrameCodec.readFrame(input)!!, StandardCharsets.UTF_8))
                        assertEquals("video", hello.getString("channel"))
                        FrameCodec.writeFrame(
                            output,
                            ByteBuffer.allocate(9).order(ByteOrder.BIG_ENDIAN)
                                .put(2).putInt(720).putInt(1280).array(),
                        )
                    }
                }
            } catch (error: Throwable) {
                failure.set(error)
            }
        }.apply { start() }

        lateinit var session: RemoteVideoSession
        session = RemoteVideoSession(
            packageName = "example.package",
            offer = offer,
            listener = object : RemoteVideoSessionListener {
                override fun onVideoConnected() = Unit
                override fun onVideoMessage(message: RemoteVideoMessage) {
                    val size = message as RemoteVideoMessage.Size
                    assertEquals(720, size.width)
                    received.countDown()
                }
                override fun onVideoDisconnected(reason: String) = Unit
            },
        )
        session.start()
        assertTrue(received.await(3, TimeUnit.SECONDS))
        session.stop()
        serverThread.join(3_000)
        assertEquals(null, failure.get())
    }

    @Test
    fun reconnectsVideoIndependentlyWithinWindow() {
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val sizes = CountDownLatch(2)
        val failure = AtomicReference<Throwable?>(null)
        val offer = RemoteControlOffer(
            host = "127.0.0.1",
            port = server.localPort,
            token = "cd".repeat(32),
            generation = 9,
            sessionId = "session_video_retry",
            target = RemoteTarget("serial", "Target"),
            permissions = setOf("view"),
        )
        val serverThread = Thread {
            try {
                server.use { listener ->
                    repeat(2) { index ->
                        listener.accept().use { socket ->
                            val input = BufferedInputStream(socket.getInputStream())
                            val output = BufferedOutputStream(socket.getOutputStream())
                            val hello = JSONObject(
                                String(FrameCodec.readFrame(input)!!, StandardCharsets.UTF_8),
                            )
                            assertEquals("video", hello.getString("channel"))
                            FrameCodec.writeFrame(
                                output,
                                ByteBuffer.allocate(9).order(ByteOrder.BIG_ENDIAN)
                                    .put(2).putInt(720 + index).putInt(1280).array(),
                            )
                        }
                    }
                }
            } catch (error: Throwable) {
                failure.set(error)
            }
        }.apply { start() }

        val session = RemoteVideoSession(
            packageName = "example.package",
            offer = offer,
            reconnectPolicy = RemoteReconnectPolicy(10, 10, 2_000, 0.0),
            randomUnit = { 0.5 },
            listener = object : RemoteVideoSessionListener {
                override fun onVideoConnected() = Unit
                override fun onVideoMessage(message: RemoteVideoMessage) { sizes.countDown() }
                override fun onVideoDisconnected(reason: String) = Unit
            },
        )
        session.start()
        assertTrue(sizes.await(3, TimeUnit.SECONDS))
        session.stop()
        serverThread.join(3_000)
        assertEquals(null, failure.get())
    }

    @Test
    fun explicitVideoStopInterruptsBackoffWithoutFinalDisconnectCallback() {
        val sleeping = CountDownLatch(1)
        val sleepExited = CountDownLatch(1)
        val connectCalls = AtomicInteger(0)
        val disconnected = AtomicBoolean(false)
        val session = RemoteVideoSession(
            packageName = "example.package",
            offer = RemoteControlOffer(
                "127.0.0.1",
                12345,
                "ef".repeat(32),
                10,
                "video_stop",
                RemoteTarget("serial", "Target"),
                setOf("view"),
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
            listener = object : RemoteVideoSessionListener {
                override fun onVideoConnected() = Unit
                override fun onVideoMessage(message: RemoteVideoMessage) = Unit
                override fun onVideoDisconnected(reason: String) { disconnected.set(true) }
            },
        )
        session.start()
        assertTrue(sleeping.await(2, TimeUnit.SECONDS))
        session.stop()
        assertTrue(sleepExited.await(2, TimeUnit.SECONDS))
        Thread.sleep(30)
        assertEquals(1, connectCalls.get())
        assertFalse(disconnected.get())
    }

    private class FailingConnectSocket : Socket() {
        override fun connect(endpoint: SocketAddress?, timeout: Int) {
            throw ConnectException("expected test failure")
        }
    }
}
