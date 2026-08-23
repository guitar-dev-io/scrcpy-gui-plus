package com.scrcpyguiplus.companion

import java.nio.charset.StandardCharsets
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolJsonTest {
    @Test
    fun parsesValidRequestSchema() {
        val request = ProtocolJson.parseRequest(
            requestJson(id = Long.MAX_VALUE, method = "clipboard_set", params = "{\"text\":\"hello\"}"),
        )

        assertEquals(Long.MAX_VALUE, request.id)
        assertEquals("clipboard_set", request.method)
        assertEquals("hello", request.params.getString("text"))
    }

    @Test
    fun rejectsInvalidRequestSchemas() {
        val invalidRequests = listOf(
            "{}",
            """{"type":"event","id":1,"method":"ping","params":{}}""",
            """{"type":"request","id":"1","method":"ping","params":{}}""",
            """{"type":"request","id":1,"method":2,"params":{}}""",
            """{"type":"request","id":1,"method":"   ","params":{}}""",
            """{"type":"request","id":1,"method":"ping","params":[]}""",
            """{"type":"request","id":1,"method":"ping"}""",
        )

        invalidRequests.forEach { json ->
            assertThrows(RequestParseException::class.java) {
                ProtocolJson.parseRequest(json.toByteArray(StandardCharsets.UTF_8))
            }
        }
    }

    @Test
    fun preservesReadableIdWhenLaterSchemaValidationFails() {
        val error = assertThrows(RequestParseException::class.java) {
            ProtocolJson.parseRequest(
                """{"type":"request","id":42,"method":"ping","params":[]}"""
                    .toByteArray(StandardCharsets.UTF_8),
            )
        }

        assertEquals(42L, error.requestId)
        assertEquals("request.params must be an object", error.message)
    }

    @Test
    fun rejectsMalformedJsonAndInvalidUtf8() {
        assertThrows(RequestParseException::class.java) {
            ProtocolJson.parseRequest("not-json".toByteArray(StandardCharsets.UTF_8))
        }
        val utf8Error = assertThrows(RequestParseException::class.java) {
            ProtocolJson.parseRequest(byteArrayOf(0xC3.toByte(), 0x28))
        }
        assertEquals("request must be valid UTF-8", utf8Error.message)
    }

    @Test
    fun rejectsExcessiveJsonNesting() {
        val nestedValue = "[".repeat(70) + "0" + "]".repeat(70)
        val payload =
            """{"type":"request","id":1,"method":"ping","params":{"value":$nestedValue}}"""
                .toByteArray(StandardCharsets.UTF_8)

        val error = assertThrows(RequestParseException::class.java) {
            ProtocolJson.parseRequest(payload)
        }

        assertTrue(error.message!!.contains("nesting exceeds"))
    }

    @Test
    fun rejectsFractionalAndOutOfRangeIds() {
        val invalidIds = listOf("1.5", "9223372036854775808", "-9223372036854775809")

        invalidIds.forEach { id ->
            assertThrows(RequestParseException::class.java) {
                ProtocolJson.parseRequest(
                    """{"type":"request","id":$id,"method":"ping","params":{}}"""
                        .toByteArray(StandardCharsets.UTF_8),
                )
            }
        }
    }

    @Test
    fun helloAdvertisesProtocolAndAllCapabilities() {
        val hello = JSONObject(
            String(
                ProtocolJson.helloFrame("Companion", "example.package", "1.2.3"),
                StandardCharsets.UTF_8,
            ),
        )

        assertEquals("hello", hello.getString("type"))
        assertEquals(1, hello.getInt("protocol"))
        assertEquals("Companion", hello.getString("app"))
        assertEquals("example.package", hello.getString("package"))
        assertEquals("1.2.3", hello.getString("version"))
        val capabilities = hello.getJSONArray("capabilities")
        assertEquals(ProtocolJson.CAPABILITIES.size, capabilities.length())
        assertEquals(
            ProtocolJson.CAPABILITIES,
            (0 until capabilities.length()).map { index -> capabilities.getString(index) },
        )
    }

    @Test
    fun successResponseHasStableShape() {
        val response = JSONObject(
            String(
                ProtocolJson.successResponse(7, JSONObject().put("message", "pong")),
                StandardCharsets.UTF_8,
            ),
        )

        assertEquals(setOf("type", "id", "ok", "result", "error"), response.keys().asSequence().toSet())
        assertEquals("response", response.getString("type"))
        assertEquals(7L, response.getLong("id"))
        assertTrue(response.getBoolean("ok"))
        assertEquals("pong", response.getJSONObject("result").getString("message"))
        assertTrue(response.isNull("error"))
    }

    @Test
    fun errorResponseHasStableShape() {
        val response = JSONObject(
            String(ProtocolJson.errorResponse(9, "bad request"), StandardCharsets.UTF_8),
        )

        assertEquals(setOf("type", "id", "ok", "result", "error"), response.keys().asSequence().toSet())
        assertEquals("response", response.getString("type"))
        assertEquals(9L, response.getLong("id"))
        assertFalse(response.getBoolean("ok"))
        assertTrue(response.isNull("result"))
        assertEquals("bad request", response.getString("error"))
    }

    private fun requestJson(id: Long, method: String, params: String): ByteArray =
        """{"type":"request","id":$id,"method":"$method","params":$params}"""
            .toByteArray(StandardCharsets.UTF_8)
}
