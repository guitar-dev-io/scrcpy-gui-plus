package com.scrcpyguiplus.companion

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import java.util.ArrayDeque

/** A bounded, single-threaded MediaCodec owner for the target's H.264 stream. */
class RemoteVideoRenderer(
    surfaceView: SurfaceView,
    private val logger: (String) -> Unit,
) : SurfaceHolder.Callback {
    private val holder = surfaceView.holder
    private val worker = HandlerThread("companion-h264-decoder").apply { start() }
    private val handler = Handler(worker.looper)
    private val pending = ArrayDeque<RemoteVideoMessage.Packet>()
    private var codec: MediaCodec? = null
    private var surface: Surface? = null
    private var width = 0
    private var height = 0
    private var drainScheduled = false
    @Volatile private var released = false

    init { holder.addCallback(this) }

    fun setVideoSize(newWidth: Int, newHeight: Int) {
        if (released) return
        handler.post {
            if (width == newWidth && height == newHeight) return@post
            width = newWidth
            height = newHeight
            restartCodec()
        }
    }

    fun queue(packet: RemoteVideoMessage.Packet) {
        if (released) return
        handler.post {
            if (pending.size >= MAX_PENDING_PACKETS) {
                // Prefer dropping an old delta frame. A new key frame makes all older work stale.
                if (packet.isKeyFrame) pending.clear() else pending.removeFirst()
            }
            pending.addLast(packet)
            ensureCodec()
            drain()
        }
    }

    /** Drops decoder state from the old TCP stream before accepting a new config/key frame. */
    fun resetForReconnect() {
        if (released) return
        handler.post {
            pending.clear()
            releaseCodec()
            ensureCodec()
        }
    }

    fun release() {
        if (released) return
        released = true
        holder.removeCallback(this)
        handler.post {
            pending.clear()
            releaseCodec()
            worker.quitSafely()
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        if (released) return
        handler.post { surface = holder.surface; ensureCodec(); drain() }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        if (released) return
        handler.post { surface = null; releaseCodec() }
    }

    private fun ensureCodec() {
        if (codec != null || width <= 0 || height <= 0 || surface?.isValid != true) return
        try {
            val decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            decoder.configure(
                MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height),
                surface,
                null,
                0,
            )
            decoder.start()
            codec = decoder
            logger("H.264 decoder started at ${width}x$height")
        } catch (error: Exception) {
            releaseCodec()
            logger("Could not start H.264 decoder: ${error.message ?: "unknown error"}")
        }
    }

    private fun restartCodec() {
        releaseCodec()
        // Configuration and key frames already queued by the network reader are preserved.
        ensureCodec()
        drain()
    }

    private fun drain() {
        drainScheduled = false
        val decoder = codec ?: return
        try {
            while (pending.isNotEmpty()) {
                val inputIndex = decoder.dequeueInputBuffer(0)
                if (inputIndex < 0) break
                val packet = pending.removeFirst()
                val inputBuffer = decoder.getInputBuffer(inputIndex)
                    ?: throw IllegalStateException("Decoder input buffer is unavailable")
                if (packet.data.size > inputBuffer.capacity()) {
                    logger("Dropped oversized H.264 packet (${packet.data.size} bytes)")
                    decoder.queueInputBuffer(inputIndex, 0, 0, packet.presentationTimeUs, 0)
                    continue
                }
                inputBuffer.clear()
                inputBuffer.put(packet.data)
                val codecFlags = when {
                    packet.isConfig -> MediaCodec.BUFFER_FLAG_CODEC_CONFIG
                    packet.isKeyFrame -> MediaCodec.BUFFER_FLAG_KEY_FRAME
                    else -> 0
                }
                decoder.queueInputBuffer(
                    inputIndex,
                    0,
                    packet.data.size,
                    packet.presentationTimeUs,
                    codecFlags,
                )
            }
            val info = MediaCodec.BufferInfo()
            while (true) {
                val outputIndex = decoder.dequeueOutputBuffer(info, 0)
                if (outputIndex < 0) break
                decoder.releaseOutputBuffer(outputIndex, true)
            }
        } catch (error: Exception) {
            logger("H.264 decoder failed: ${error.message ?: "unknown error"}")
            releaseCodec()
        }
        if (pending.isNotEmpty() && codec != null && !drainScheduled) {
            drainScheduled = true
            handler.postDelayed(::drain, DRAIN_RETRY_MS)
        }
    }

    private fun releaseCodec() {
        val old = codec
        codec = null
        if (old != null) {
            runCatching { old.stop() }
            runCatching { old.release() }
        }
    }

    private companion object {
        const val MAX_PENDING_PACKETS = 8
        const val DRAIN_RETRY_MS = 8L
    }
}
