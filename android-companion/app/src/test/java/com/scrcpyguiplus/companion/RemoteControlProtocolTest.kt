package com.scrcpyguiplus.companion

import java.nio.charset.StandardCharsets
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteControlProtocolTest {
    @Test
    fun parsesAndNormalizesStrictOffer() {
        val offer = RemoteControlProtocol.parseOffer(
            validOffer()
                .put("host", "192.168.001.007")
                .put("permissions", JSONArray().put("view").put("control")),
        )

        assertEquals("192.168.1.7", offer.host)
        assertEquals(4321, offer.port)
        assertEquals("ab".repeat(32), offer.token)
        assertEquals(17L, offer.generation)
        assertEquals("session_123", offer.sessionId)
        assertEquals("device-serial", offer.target.serial)
        assertEquals("Pixel target", offer.target.label)
        assertEquals(setOf("view", "control"), offer.permissions)
    }

    @Test
    fun rejectsPublicAndMalformedHosts() {
        listOf("8.8.8.8", "example.com", "192.168.1", "256.1.1.1").forEach { host ->
            assertThrows(IllegalArgumentException::class.java) {
                RemoteControlProtocol.parseOffer(validOffer().put("host", host))
            }
        }
    }

    @Test
    fun rejectsInvalidSecurityAndTargetFields() {
        val invalidOffers = listOf(
            validOffer().put("token", "short"),
            validOffer().put("generation", 0),
            validOffer().put("generation", 1.5),
            validOffer().put("sessionId", "bad session"),
            validOffer().put("target", JSONObject().put("serial", "serial")),
            validOffer().put("target", JSONObject().put("serial", "\n").put("label", "label")),
            validOffer().put("unexpected", true),
            validOffer().put(
                "target",
                JSONObject().put("serial", "serial").put("label", "label").put("extra", true),
            ),
        )

        invalidOffers.forEach { offer ->
            assertThrows(IllegalArgumentException::class.java) {
                RemoteControlProtocol.parseOffer(offer)
            }
        }
    }

    @Test
    fun remoteHelloHasStableAuthenticatedShape() {
        val offer = RemoteControlProtocol.parseOffer(validOffer())
        val hello = JSONObject(
            String(RemoteControlProtocol.helloFrame("example.package", offer), StandardCharsets.UTF_8),
        )

        assertEquals("remote_hello", hello.getString("type"))
        assertEquals(1, hello.getInt("protocol"))
        assertEquals("example.package", hello.getString("package"))
        assertEquals(offer.token, hello.getString("token"))
        assertEquals(offer.generation, hello.getLong("generation"))
        assertEquals(offer.sessionId, hello.getString("sessionId"))
        assertFalse(hello.has("channel"))

        val videoHello = JSONObject(
            String(RemoteControlProtocol.videoHelloFrame("example.package", offer), StandardCharsets.UTF_8),
        )
        assertEquals("video", videoHello.getString("channel"))
    }

    @Test
    fun rejectsUnknownOrDuplicatePermissions() {
        listOf(
            JSONArray().put("admin"),
            JSONArray().put("view").put("view"),
            JSONArray().put(3),
        ).forEach { permissions ->
            assertThrows(IllegalArgumentException::class.java) {
                RemoteControlProtocol.parseOffer(validOffer().put("permissions", permissions))
            }
        }
    }

    @Test
    fun requestAndResponseRequireCorrelatedIds() {
        val request = JSONObject(
            String(RemoteControlProtocol.requestFrame(9, "home"), StandardCharsets.UTF_8),
        )
        assertEquals("remote_request", request.getString("type"))
        assertEquals(9L, request.getLong("id"))
        assertEquals("home", request.getString("method"))
        assertEquals(0, request.getJSONObject("params").length())

        val response = RemoteControlProtocol.parseResponse(
            JSONObject()
                .put("type", "remote_response")
                .put("id", 9)
                .put("ok", true)
                .put("result", JSONObject().put("accepted", true))
                .put("error", JSONObject.NULL)
                .toString()
                .toByteArray(StandardCharsets.UTF_8),
            expectedId = 9,
        )
        assertTrue(response.ok)
        assertEquals(true, response.result!!.getBoolean("accepted"))

        assertThrows(IllegalArgumentException::class.java) {
            RemoteControlProtocol.parseResponse(
                JSONObject()
                    .put("type", "remote_response")
                    .put("id", 10)
                    .put("ok", false)
                    .put("result", JSONObject.NULL)
                    .put("error", "denied")
                    .toString()
                    .toByteArray(StandardCharsets.UTF_8),
                expectedId = 9,
            )
        }
    }

    @Test
    fun rejectsInconsistentResponseShape() {
        val payload = JSONObject()
            .put("type", "remote_response")
            .put("id", 1)
            .put("ok", false)
            .put("result", JSONObject())
            .put("error", JSONObject.NULL)
            .toString()
            .toByteArray(StandardCharsets.UTF_8)

        val error = assertThrows(IllegalArgumentException::class.java) {
            RemoteControlProtocol.parseResponse(payload, expectedId = 1)
        }
        assertFalse(error.message.isNullOrBlank())
    }

    private fun validOffer(): JSONObject = JSONObject()
        .put("host", "192.168.1.7")
        .put("port", 4321)
        .put("token", "AB".repeat(32))
        .put("generation", 17)
        .put("sessionId", "session_123")
        .put(
            "target",
            JSONObject()
                .put("serial", "device-serial")
                .put("label", "Pixel target"),
        )
}
