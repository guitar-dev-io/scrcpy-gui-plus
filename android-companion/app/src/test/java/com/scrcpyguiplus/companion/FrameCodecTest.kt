package com.scrcpyguiplus.companion

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class FrameCodecTest {
    @Test
    fun writesBigEndianLengthAndPayload() {
        val output = ByteArrayOutputStream()
        val payload = byteArrayOf(0x01, 0x7F, 0x00)

        FrameCodec.writeFrame(output, payload)

        assertArrayEquals(
            byteArrayOf(0x00, 0x00, 0x00, 0x03, 0x01, 0x7F, 0x00),
            output.toByteArray(),
        )
    }

    @Test
    fun writesScreenFramesWithTheLargerBoundedLimit() {
        val output = ByteArrayOutputStream()

        FrameCodec.writeScreenFrame(output, byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()))

        assertArrayEquals(
            byteArrayOf(0, 0, 0, 4, 0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()),
            output.toByteArray(),
        )
    }

    @Test
    fun rejectsScreenPayloadsAboveTwoMiB() {
        assertThrows(IllegalArgumentException::class.java) {
            FrameCodec.writeScreenFrame(
                ByteArrayOutputStream(),
                ByteArray(FrameCodec.MAX_SCREEN_PAYLOAD_BYTES + 1),
            )
        }
    }

    @Test
    fun writesFrameWithPartialOutputWrites() {
        val output = SingleByteOutputStream()

        FrameCodec.writeFrame(output, byteArrayOf(0x10, 0x20, 0x30))

        assertArrayEquals(
            byteArrayOf(0x00, 0x00, 0x00, 0x03, 0x10, 0x20, 0x30),
            output.toByteArray(),
        )
    }

    @Test
    fun readsHeaderAndPayloadAcrossPartialReads() {
        val bytes = byteArrayOf(0x00, 0x00, 0x00, 0x03, 0x41, 0x42, 0x43)

        val result = FrameCodec.readFrame(OneByteAtATimeInputStream(bytes))

        assertArrayEquals(byteArrayOf(0x41, 0x42, 0x43), result)
    }

    @Test
    fun returnsNullWhenHostDisconnectsBeforeAFrame() {
        assertNull(FrameCodec.readFrame(ByteArrayInputStream(ByteArray(0))))
    }

    @Test
    fun rejectsZeroLengthPayload() {
        assertThrows(FrameProtocolException::class.java) {
            FrameCodec.readFrame(ByteArrayInputStream(byteArrayOf(0, 0, 0, 0)))
        }
    }

    @Test
    fun rejectsPayloadLargerThanOneMiB() {
        val header = byteArrayOf(0x00, 0x10, 0x00, 0x01)
        assertThrows(FrameProtocolException::class.java) {
            FrameCodec.readFrame(ByteArrayInputStream(header))
        }
    }

    @Test
    fun rejectsTruncatedPayload() {
        val bytes = byteArrayOf(0x00, 0x00, 0x00, 0x03, 0x41)
        assertThrows(EOFException::class.java) {
            FrameCodec.readFrame(ByteArrayInputStream(bytes))
        }
    }

    private class SingleByteOutputStream : OutputStream() {
        private val delegate = ByteArrayOutputStream()

        override fun write(value: Int) {
            delegate.write(value)
        }

        fun toByteArray(): ByteArray = delegate.toByteArray()
    }

    private class OneByteAtATimeInputStream(data: ByteArray) : InputStream() {
        private val delegate = ByteArrayInputStream(data)

        override fun read(): Int = delegate.read()

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            return delegate.read(buffer, offset, 1)
        }
    }
}
