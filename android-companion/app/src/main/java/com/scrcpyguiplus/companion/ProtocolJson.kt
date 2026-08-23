package com.scrcpyguiplus.companion

import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

class RequestParseException(
    message: String,
    val requestId: Long? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

data class ProtocolRequest(
    val id: Long,
    val method: String,
    val params: JSONObject,
)

/** JSON encoding/decoding for the small, versioned AOA application protocol. */
object ProtocolJson {
    val CAPABILITIES: List<String> = listOf(
        "ping",
        "get_device_info",
        "clipboard_set",
        "clipboard_get",
        "open_url",
        "start_screen_share",
        "stop_screen_share",
        "start_remote_control",
        "stop_remote_control",
    )

    private val UTF_8 = StandardCharsets.UTF_8
    private val LONG_MIN = BigInteger.valueOf(Long.MIN_VALUE)
    private val LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE)
    private const val MAX_ERROR_MESSAGE_CHARS = 512
    private const val MAX_JSON_NESTING = 64

    fun parseRequest(payload: ByteArray): ProtocolRequest {
        val json = parseJsonObject(payload)
        val readableId = runCatching { parseId(json.opt("id")) }.getOrNull()

        if (json.opt("type") != "request") {
            throw RequestParseException("request.type must be 'request'", requestId = readableId)
        }

        val id = parseId(json.opt("id"))
        val method = json.opt("method") as? String
            ?: throw RequestParseException("request.method must be a string", requestId = id)
        if (method.isBlank()) {
            throw RequestParseException("request.method must not be blank", requestId = id)
        }

        val params = json.opt("params") as? JSONObject
            ?: throw RequestParseException("request.params must be an object", requestId = id)
        return ProtocolRequest(id = id, method = method, params = params)
    }

    /** Best-effort correlation for a last-resort handler failure response. */
    fun extractRequestId(payload: ByteArray): Long? = runCatching {
        val json = parseJsonObject(payload)
        parseId(json.opt("id"))
    }.getOrNull()

    fun helloFrame(
        appName: String,
        packageName: String,
        version: String,
        pairingToken: String? = null,
    ): ByteArray {
        val capabilities = JSONArray()
        CAPABILITIES.forEach { capability -> capabilities.put(capability) }
        val hello = JSONObject()
            .put("type", "hello")
            .put("protocol", 1)
            .put("app", appName)
            .put("package", packageName)
            .put("version", version)
            .put("capabilities", capabilities)
        if (pairingToken != null) hello.put("token", pairingToken)
        return encode(hello)
    }

    fun successResponse(id: Long, result: JSONObject): ByteArray =
        responseFrame(id = id, ok = true, result = result, error = null)

    fun errorResponse(id: Long, message: String): ByteArray =
        responseFrame(
            id = id,
            ok = false,
            result = null,
            error = message
                .replace('\n', ' ')
                .replace('\r', ' ')
                .ifBlank { "request failed" }
                .take(MAX_ERROR_MESSAGE_CHARS),
        )

    fun responseFrame(
        id: Long,
        ok: Boolean,
        result: JSONObject?,
        error: String?,
    ): ByteArray {
        val response = JSONObject()
            .put("type", "response")
            .put("id", id)
            .put("ok", ok)
            .put("result", result ?: JSONObject.NULL)
            .put("error", error ?: JSONObject.NULL)
        return encode(response)
    }

    fun encode(json: JSONObject): ByteArray = json.toString().toByteArray(UTF_8)

    private fun parseJsonObject(payload: ByteArray): JSONObject {
        val text = try {
            UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(payload))
                .toString()
        } catch (error: Exception) {
            throw RequestParseException("request must be valid UTF-8", cause = error)
        }
        validateNesting(text)

        return try {
            JSONObject(text)
        } catch (error: StackOverflowError) {
            throw RequestParseException("request JSON nesting is too deep", cause = error)
        } catch (error: Exception) {
            throw RequestParseException("invalid JSON request", cause = error)
        }
    }

    /** Bounds recursive parser work without interpreting braces or brackets inside JSON strings. */
    private fun validateNesting(text: String) {
        var depth = 0
        var inString = false
        var escaped = false
        text.forEach { character ->
            if (inString) {
                when {
                    escaped -> escaped = false
                    character == '\\' -> escaped = true
                    character == '"' -> inString = false
                }
            } else {
                when (character) {
                    '"' -> inString = true
                    '{', '[' -> {
                        depth += 1
                        if (depth > MAX_JSON_NESTING) {
                            throw RequestParseException(
                                "request JSON nesting exceeds $MAX_JSON_NESTING levels",
                            )
                        }
                    }
                    '}', ']' -> if (depth > 0) depth -= 1
                }
            }
        }
    }

    private fun parseId(value: Any?): Long {
        if (value !is Number) {
            throw RequestParseException("request.id must be a number")
        }

        val decimal = try {
            BigDecimal(value.toString())
        } catch (error: NumberFormatException) {
            throw RequestParseException("request.id must be a finite integer number", cause = error)
        }
        val integer = try {
            decimal.toBigIntegerExact()
        } catch (error: ArithmeticException) {
            throw RequestParseException("request.id must be an integer number", cause = error)
        }
        if (integer < LONG_MIN || integer > LONG_MAX) {
            throw RequestParseException("request.id is out of range")
        }
        return integer.toLong()
    }
}
