package com.scrcpyguiplus.companion

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** Thrown when the byte stream contains an invalid protocol frame. */
class FrameProtocolException(message: String) : IOException(message)

/**
 * AOA application framing: a 4-byte unsigned big-endian payload length followed by UTF-8 JSON.
 * The underlying accessory is a stream, so reads are deliberately exact and may span many reads.
 */
object FrameCodec {
    const val MAX_PAYLOAD_BYTES = 1024 * 1024
    const val MAX_SCREEN_PAYLOAD_BYTES = 2 * 1024 * 1024
    const val MAX_REMOTE_VIDEO_PAYLOAD_BYTES = 32 * 1024 * 1024 + 14
    private const val HEADER_BYTES = 4

    /**
     * Reads one frame. A clean EOF before any header byte means that the host disconnected and is
     * returned as null. An EOF in a partially received header or payload is reported explicitly.
     */
    fun readFrame(input: InputStream): ByteArray? {
        return readFrame(input, MAX_PAYLOAD_BYTES)
    }

    /** Reads a frame with a caller-selected, still-bounded payload limit. */
    fun readFrame(input: InputStream, maxPayloadBytes: Int): ByteArray? {
        require(maxPayloadBytes in 1..MAX_REMOTE_VIDEO_PAYLOAD_BYTES)
        val header = ByteArray(HEADER_BYTES)
        val headerRead = readUntilEof(input, header, 0, header.size)
        if (headerRead == 0) {
            return null
        }
        if (headerRead != HEADER_BYTES) {
            throw EOFException("Connection closed in the frame header")
        }

        val length =
            ((header[0].toLong() and 0xFFL) shl 24) or
                ((header[1].toLong() and 0xFFL) shl 16) or
                ((header[2].toLong() and 0xFFL) shl 8) or
                (header[3].toLong() and 0xFFL)

        if (length !in 1L..maxPayloadBytes.toLong()) {
            throw FrameProtocolException(
                "Invalid payload length $length; expected 1..$maxPayloadBytes bytes",
            )
        }

        val payload = ByteArray(length.toInt())
        val payloadRead = readUntilEof(input, payload, 0, payload.size)
        if (payloadRead != payload.size) {
            throw EOFException("Connection closed in a $length-byte payload")
        }
        return payload
    }

    /** Writes one complete frame and flushes it so the host can process it immediately. */
    fun writeFrame(output: OutputStream, payload: ByteArray) {
        require(payload.isNotEmpty()) { "Payload must not be empty" }
        require(payload.size <= MAX_PAYLOAD_BYTES) {
            "Payload is ${payload.size} bytes; maximum is $MAX_PAYLOAD_BYTES bytes"
        }

        val length = payload.size
        val header = byteArrayOf(
            ((length ushr 24) and 0xFF).toByte(),
            ((length ushr 16) and 0xFF).toByte(),
            ((length ushr 8) and 0xFF).toByte(),
            (length and 0xFF).toByte(),
        )

        writeFully(output, header)
        writeFully(output, payload)
        output.flush()
    }

    private fun readUntilEof(
        input: InputStream,
        buffer: ByteArray,
        offset: Int,
        length: Int,
    ): Int {
        var total = 0
        while (total < length) {
            val count = input.read(buffer, offset + total, length - total)
            when {
                count < 0 -> return total
                count == 0 -> {
                    // Some stream wrappers are allowed to make no progress. Read one byte to
                    // avoid a busy loop while still preserving exact-byte semantics.
                    val oneByte = input.read()
                    if (oneByte < 0) return total
                    buffer[offset + total] = oneByte.toByte()
                    total += 1
                }
                else -> total += count
            }
        }
        return total
    }

    /** Writes one complete screen frame using the larger bounded JPEG payload limit. */
    fun writeScreenFrame(output: OutputStream, payload: ByteArray) {
        writeFrame(output, payload, MAX_SCREEN_PAYLOAD_BYTES)
    }

    private fun writeFrame(output: OutputStream, payload: ByteArray, maxBytes: Int) {
        require(payload.isNotEmpty()) { "Payload must not be empty" }
        require(payload.size <= maxBytes) {
            "Payload is ${payload.size} bytes; maximum is $maxBytes bytes"
        }

        val length = payload.size
        val header = byteArrayOf(
            ((length ushr 24) and 0xFF).toByte(),
            ((length ushr 16) and 0xFF).toByte(),
            ((length ushr 8) and 0xFF).toByte(),
            (length and 0xFF).toByte(),
        )

        writeFully(output, header)
        writeFully(output, payload)
        output.flush()
    }

    private fun writeFully(output: OutputStream, bytes: ByteArray) {
        var offset = 0
        while (offset < bytes.size) {
            // OutputStream.write(byte[], off, len) is an all-or-throws API. Bounded writes keep
            // the operation exact and avoid relying on one large write to the accessory stream.
            val count = minOf(8 * 1024, bytes.size - offset)
            output.write(bytes, offset, count)
            offset += count
        }
    }
}
