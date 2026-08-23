package com.scrcpyguiplus.companion

import java.nio.charset.StandardCharsets
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolProcessorTest {
    @Test
    fun malformedJsonReturnsErrorAndNextRequestSucceeds() {
        val processor = ProtocolProcessor(::pingOnly)

        val malformed = response(processor.process("not-json".toByteArray(StandardCharsets.UTF_8)))
        assertEquals(0L, malformed.getLong("id"))
        assertFalse(malformed.getBoolean("ok"))
        assertTrue(malformed.getString("error").startsWith("invalid request:"))

        val following = response(processor.process(request(2, "ping")))
        assertEquals(2L, following.getLong("id"))
        assertTrue(following.getBoolean("ok"))
        assertEquals("pong", following.getJSONObject("result").getString("message"))
    }

    @Test
    fun malformedRequestUsesReadableId() {
        val processor = ProtocolProcessor(::pingOnly)
        val malformed = """{"type":"request","id":41,"method":"ping","params":[]}"""
            .toByteArray(StandardCharsets.UTF_8)

        val result = response(processor.process(malformed))

        assertEquals(41L, result.getLong("id"))
        assertFalse(result.getBoolean("ok"))
        assertTrue(result.isNull("result"))
    }

    @Test
    fun unknownMethodReturnsErrorAndNextRequestSucceeds() {
        val processor = ProtocolProcessor(::pingOnly)

        val unknown = response(processor.process(request(3, "does_not_exist")))
        assertEquals(3L, unknown.getLong("id"))
        assertFalse(unknown.getBoolean("ok"))
        assertTrue(unknown.getString("error").contains("unknown method"))

        val following = response(processor.process(request(4, "ping")))
        assertEquals(4L, following.getLong("id"))
        assertTrue(following.getBoolean("ok"))
    }

    @Test
    fun handlerExceptionReturnsErrorAndNextRequestSucceeds() {
        val processor = ProtocolProcessor(requestHandler = { request ->
            if (request.method == "explode") throw IllegalStateException("handler exploded")
            pingOnly(request)
        })

        val failed = response(processor.process(request(5, "explode")))
        assertEquals(5L, failed.getLong("id"))
        assertFalse(failed.getBoolean("ok"))
        assertEquals("handler exploded", failed.getString("error"))

        val following = response(processor.process(request(6, "ping")))
        assertEquals(6L, following.getLong("id"))
        assertTrue(following.getBoolean("ok"))
    }

    @Test
    fun oversizedSuccessBecomesBoundedError() {
        val processor = ProtocolProcessor(requestHandler = {
            ProtocolHandlerResult(
                JSONObject().put("blob", "x".repeat(FrameCodec.MAX_PAYLOAD_BYTES)),
            )
        })

        val encoded = processor.process(request(7, "large"))
        val result = response(encoded)

        assertTrue(encoded.size <= FrameCodec.MAX_PAYLOAD_BYTES)
        assertEquals(7L, result.getLong("id"))
        assertFalse(result.getBoolean("ok"))
        assertEquals("response exceeds the 1 MiB payload limit", result.getString("error"))
    }

    @Test
    fun sessionGuardRecoversFromUnexpectedDelegateException() {
        var calls = 0
        val guarded = ResilientRequestHandler(
            delegate = { payload ->
                calls += 1
                if (calls == 1) throw IllegalArgumentException("unexpected delegate failure")
                val id = ProtocolJson.parseRequest(payload).id
                PreparedResponse(
                    ProtocolJson.successResponse(id, JSONObject().put("message", "recovered")),
                )
            },
        )

        val failed = response(guarded.handle(request(8, "ping")).payload)
        assertEquals(8L, failed.getLong("id"))
        assertFalse(failed.getBoolean("ok"))
        assertTrue(failed.getString("error").contains("unexpected delegate failure"))

        val following = response(guarded.handle(request(9, "ping")).payload)
        assertEquals(9L, following.getLong("id"))
        assertTrue(following.getBoolean("ok"))
        assertEquals("recovered", following.getJSONObject("result").getString("message"))
    }

    @Test
    fun postResponseActionRemainsDeferredUntilAfterWrite() {
        var actionRan = false
        val processor = ProtocolProcessor(requestHandler = {
            ProtocolHandlerResult(
                result = JSONObject().put("opened", true),
                afterResponse = { actionRan = true },
            )
        })

        val prepared = processor.prepare(request(10, "open_url"))

        assertFalse(actionRan)
        assertTrue(response(prepared.payload).getBoolean("ok"))
        requireNotNull(prepared.afterWrite).invoke()
        assertTrue(actionRan)
    }

    @Test
    fun stackOverflowFromHandlerReturnsErrorAndNextRequestSucceeds() {
        val processor = ProtocolProcessor(requestHandler = { request ->
            if (request.method == "overflow") throw StackOverflowError()
            pingOnly(request)
        })

        val failed = response(processor.process(request(11, "overflow")))
        assertEquals(11L, failed.getLong("id"))
        assertFalse(failed.getBoolean("ok"))
        assertEquals("request data nesting is too deep", failed.getString("error"))

        val following = response(processor.process(request(12, "ping")))
        assertEquals(12L, following.getLong("id"))
        assertTrue(following.getBoolean("ok"))
    }

    private fun pingOnly(request: ProtocolRequest): ProtocolHandlerResult {
        if (request.method != "ping") {
            throw IllegalArgumentException("unknown method: ${request.method}")
        }
        return ProtocolHandlerResult(JSONObject().put("message", "pong"))
    }

    private fun request(id: Long, method: String): ByteArray =
        """{"type":"request","id":$id,"method":"$method","params":{}}"""
            .toByteArray(StandardCharsets.UTF_8)

    private fun response(payload: ByteArray): JSONObject =
        JSONObject(String(payload, StandardCharsets.UTF_8))
}
