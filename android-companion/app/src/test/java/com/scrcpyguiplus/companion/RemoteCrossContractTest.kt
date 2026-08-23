package com.scrcpyguiplus.companion

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Locks the Android half of the desktop/mobile remote protocol against accidental drift. */
class RemoteCrossContractTest {
    @Test
    fun offerAndBothHelloChannelsMatchFinalEnvelope() {
        val offerJson = JSONObject()
            .put("host", "192.168.1.9")
            .put("port", 27183)
            .put("token", "ab".repeat(32))
            .put("generation", 42)
            .put("sessionId", "remote-session_42")
            .put("target", JSONObject().put("serial", "device-1").put("label", "Pixel"))
            .put("permissions", JSONArray(listOf("view", "control", "keyboard", "clipboard")))
        val offer = RemoteControlProtocol.parseOffer(offerJson)
        assertEquals(RemoteControlProtocol.SUPPORTED_PERMISSIONS, offer.permissions)

        val control = json(RemoteControlProtocol.helloFrame("controller.pkg", offer))
        assertEquals(
            setOf("type", "protocol", "package", "token", "generation", "sessionId"),
            control.keys().asSequence().toSet(),
        )
        assertFalse(control.has("channel"))

        val video = json(RemoteControlProtocol.videoHelloFrame("controller.pkg", offer))
        assertEquals(control.keys().asSequence().toSet() + "channel", video.keys().asSequence().toSet())
        assertEquals("video", video.getString("channel"))
        assertEquals(control.getString("token"), video.getString("token"))
        assertEquals(control.getLong("generation"), video.getLong("generation"))
        assertEquals(control.getString("sessionId"), video.getString("sessionId"))
    }

    @Test
    fun absentPermissionsRemainLegacyNavigationOnlyContract() {
        val legacy = JSONObject()
            .put("host", "127.0.0.1")
            .put("port", 27183)
            .put("token", "ab".repeat(32))
            .put("generation", 1)
            .put("sessionId", "legacy")
            .put("target", JSONObject().put("serial", "serial").put("label", "Target"))
        assertTrue(RemoteControlProtocol.parseOffer(legacy).permissions.isEmpty())
    }

    @Test
    fun controlInputEnvelopesUseExactDesktopFieldNames() {
        val cases = listOf(
            "touch" to JSONObject()
                .put("action", "move").put("pointerId", 3).put("x", 100).put("y", 200)
                .put("deviceWidth", 1080).put("deviceHeight", 2400).put("pressure", 0.5),
            "key" to JSONObject().put("keycode", 66).put("metastate", 1).put("action", "down"),
            "text" to JSONObject().put("text", "hello"),
            "clipboard_set" to JSONObject().put("text", "clipboard"),
        )
        cases.forEachIndexed { index, (method, params) ->
            val request = json(RemoteControlProtocol.requestFrame(index + 1L, method, params))
            assertEquals(setOf("type", "id", "method", "params"), request.keys().asSequence().toSet())
            assertEquals("remote_request", request.getString("type"))
            assertEquals(method, request.getString("method"))
            assertEquals(params.toString(), request.getJSONObject("params").toString())
            assertFalse(request.getJSONObject("params").has("targetSerial"))
        }
    }

    @Test
    fun videoPacketAndOuterFrameBoundsMatchDesktop() {
        assertEquals(32 * 1024 * 1024 + 14, RemoteVideoProtocol.MAX_VIDEO_FRAME_BYTES)
        assertEquals(RemoteVideoProtocol.MAX_VIDEO_FRAME_BYTES, FrameCodec.MAX_REMOTE_VIDEO_PAYLOAD_BYTES)

        val accessUnit = byteArrayOf(0, 0, 0, 1, 0x65)
        val body = ByteBuffer.allocate(14 + accessUnit.size).order(ByteOrder.BIG_ENDIAN)
            .put(1).put(2).putLong(123_456).putInt(accessUnit.size).put(accessUnit).array()
        val parsed = RemoteVideoProtocol.parse(body) as RemoteVideoMessage.Packet
        assertTrue(parsed.isKeyFrame)
        assertFalse(parsed.isConfig)
        assertEquals(123_456L, parsed.presentationTimeUs)

        val tooLarge = FrameCodec.MAX_REMOTE_VIDEO_PAYLOAD_BYTES + 1
        val header = ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(tooLarge).array()
        assertThrows(FrameProtocolException::class.java) {
            FrameCodec.readFrame(ByteArrayInputStream(header), FrameCodec.MAX_REMOTE_VIDEO_PAYLOAD_BYTES)
        }
    }

    @Test
    fun utf8LimitsCountBytesNotUtf16Characters() {
        assertTrue(RemoteInputLimits.isTextAllowed("ก".repeat(100))) // 300 UTF-8 bytes
        assertFalse(RemoteInputLimits.isTextAllowed("ก".repeat(101)))
        assertTrue(RemoteInputLimits.isClipboardAllowed("😀".repeat(512))) // 2048 UTF-8 bytes
        assertFalse(RemoteInputLimits.isClipboardAllowed("😀".repeat(513)))
    }

    private fun json(payload: ByteArray): JSONObject =
        JSONObject(String(payload, StandardCharsets.UTF_8))
}
