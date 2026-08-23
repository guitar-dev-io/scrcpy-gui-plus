package com.scrcpyguiplus.companion

import java.nio.ByteBuffer
import java.nio.ByteOrder

sealed interface RemoteVideoMessage {
    data class Packet(
        val flags: Int,
        val presentationTimeUs: Long,
        val data: ByteArray,
    ) : RemoteVideoMessage {
        val isConfig: Boolean get() = flags and FLAG_CONFIG != 0
        val isKeyFrame: Boolean get() = flags and FLAG_KEY_FRAME != 0

        companion object {
            const val FLAG_CONFIG = 1
            const val FLAG_KEY_FRAME = 2
        }
    }

    data class Size(val width: Int, val height: Int) : RemoteVideoMessage
    data class Codec(val name: String) : RemoteVideoMessage
}

/** Strict parser for the binary video bodies transported inside the shared u32 framing. */
object RemoteVideoProtocol {
    // Existing embedded scrcpy transport accepts a 32 MiB H.264 access unit. The wire body adds
    // the 14-byte packet envelope, so both desktop and Android use the same exact outer bound.
    const val MAX_VIDEO_FRAME_BYTES = 32 * 1024 * 1024 + 14
    private const val PACKET_HEADER_BYTES = 14

    fun parse(payload: ByteArray): RemoteVideoMessage {
        require(payload.isNotEmpty()) { "Remote video message is empty" }
        val buffer = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN)
        return when (val kind = buffer.get().toInt() and 0xff) {
            1 -> {
                require(payload.size >= PACKET_HEADER_BYTES) { "Remote video packet is truncated" }
                val flags = buffer.get().toInt() and 0xff
                require(flags and 0xfc == 0) { "Remote video flags are invalid" }
                val pts = buffer.long
                require(pts >= 0) { "Remote video timestamp is invalid" }
                val length = buffer.int
                require(length >= 0 && length == buffer.remaining()) {
                    "Remote video packet length does not match its payload"
                }
                RemoteVideoMessage.Packet(flags, pts, ByteArray(length).also(buffer::get))
            }
            2 -> {
                require(payload.size == 9) { "Remote video size message is invalid" }
                val width = buffer.int
                val height = buffer.int
                require(width in 1..16_384 && height in 1..16_384) {
                    "Remote video dimensions are invalid"
                }
                RemoteVideoMessage.Size(width, height)
            }
            3 -> {
                require(payload.size in 2..65) { "Remote video codec message is invalid" }
                val name = payload.copyOfRange(1, payload.size).toString(Charsets.US_ASCII)
                require(name == "h264" || name == "avc") { "Unsupported remote video codec" }
                RemoteVideoMessage.Codec(name)
            }
            else -> throw IllegalArgumentException("Unknown remote video message kind $kind")
        }
    }
}

data class RemotePoint(val x: Int, val y: Int)

object RemoteCoordinateMapper {
    /** Maps a point from a center-fit Android view into the target's encoded frame. */
    fun map(
        viewX: Float,
        viewY: Float,
        viewWidth: Int,
        viewHeight: Int,
        videoWidth: Int,
        videoHeight: Int,
    ): RemotePoint? {
        if (viewWidth <= 0 || viewHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return null
        val scale = minOf(viewWidth.toFloat() / videoWidth, viewHeight.toFloat() / videoHeight)
        val shownWidth = videoWidth * scale
        val shownHeight = videoHeight * scale
        val left = (viewWidth - shownWidth) / 2f
        val top = (viewHeight - shownHeight) / 2f
        if (viewX < left || viewY < top || viewX >= left + shownWidth || viewY >= top + shownHeight) {
            return null
        }
        return RemotePoint(
            ((viewX - left) / scale).toInt().coerceIn(0, videoWidth - 1),
            ((viewY - top) / scale).toInt().coerceIn(0, videoHeight - 1),
        )
    }
}
