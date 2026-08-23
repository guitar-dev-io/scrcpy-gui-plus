package com.scrcpyguiplus.companion

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteVideoProtocolTest {
    @Test
    fun parsesPacketAndSizeFrames() {
        val h264 = byteArrayOf(0, 0, 0, 1, 0x65)
        val body = ByteBuffer.allocate(14 + h264.size).order(ByteOrder.BIG_ENDIAN)
            .put(1).put(3).putLong(42_000).putInt(h264.size).put(h264).array()
        val packet = RemoteVideoProtocol.parse(body) as RemoteVideoMessage.Packet
        assertEquals(42_000, packet.presentationTimeUs)
        assertTrue(packet.isConfig)
        assertTrue(packet.isKeyFrame)
        assertArrayEquals(h264, packet.data)

        val size = RemoteVideoProtocol.parse(
            ByteBuffer.allocate(9).order(ByteOrder.BIG_ENDIAN)
                .put(2).putInt(1080).putInt(2400).array(),
        ) as RemoteVideoMessage.Size
        assertEquals(1080, size.width)
        assertEquals(2400, size.height)
    }

    @Test
    fun rejectsMalformedVideoMessages() {
        listOf(
            byteArrayOf(),
            byteArrayOf(9),
            ByteBuffer.allocate(14).order(ByteOrder.BIG_ENDIAN)
                .put(1).put(0).putLong(0).putInt(99).array(),
            ByteBuffer.allocate(9).order(ByteOrder.BIG_ENDIAN)
                .put(2).putInt(0).putInt(10).array(),
        ).forEach { payload ->
            assertThrows(IllegalArgumentException::class.java) {
                RemoteVideoProtocol.parse(payload)
            }
        }
    }

    @Test
    fun mapsOnlyCenterFitVideoContent() {
        assertEquals(
            RemotePoint(500, 250),
            RemoteCoordinateMapper.map(500f, 500f, 1000, 1000, 1000, 500),
        )
        assertNull(RemoteCoordinateMapper.map(10f, 10f, 1000, 1000, 1000, 500))
        assertEquals(
            RemotePoint(999, 499),
            RemoteCoordinateMapper.map(999f, 749f, 1000, 1000, 1000, 500),
        )
    }
}
