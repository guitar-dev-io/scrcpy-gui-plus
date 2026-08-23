package com.scrcpyguiplus.companion

import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Locale
import org.json.JSONObject

data class RemoteTarget(
    val serial: String,
    val label: String,
)

data class RemoteControlOffer(
    val host: String,
    val port: Int,
    val token: String,
    val generation: Long,
    val sessionId: String,
    val target: RemoteTarget,
    val permissions: Set<String> = emptySet(),
)

data class RemoteControlResponse(
    val id: Long,
    val ok: Boolean,
    val result: JSONObject?,
    val error: String?,
)

/** Pure validation and JSON encoding for the controller-to-desktop socket. */
object RemoteControlProtocol {
    private val UTF_8 = StandardCharsets.UTF_8
    private val TOKEN_PATTERN = Regex("^[0-9a-fA-F]{64}$")
    private val SESSION_ID_PATTERN = Regex("^[A-Za-z0-9._:-]{1,128}$")
    private val LONG_MIN = BigInteger.valueOf(Long.MIN_VALUE)
    private val LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE)
    private const val MAX_TARGET_FIELD_CHARS = 256
    private const val MAX_JSON_NESTING = 32
    val SUPPORTED_PERMISSIONS = setOf("view", "control", "keyboard", "clipboard")

    fun parseOffer(params: JSONObject): RemoteControlOffer {
        requireOnlyKeys(
            params,
            setOf("host", "port", "token", "generation", "sessionId", "target", "permissions"),
            "Remote control offer",
        )
        val host = normalizePrivateIpv4(requiredString(params, "host", 15))
        val port = requiredInteger(params, "port")
        require(port in 1..65535) { "Remote control port is invalid" }
        val token = requiredString(params, "token", 64)
        require(TOKEN_PATTERN.matches(token)) { "Remote control token is invalid" }
        val generation = requiredLong(params, "generation")
        require(generation > 0) { "Remote control generation is invalid" }
        val sessionId = requiredString(params, "sessionId", 128)
        require(SESSION_ID_PATTERN.matches(sessionId)) { "Remote control sessionId is invalid" }
        val target = params.opt("target") as? JSONObject
            ?: throw IllegalArgumentException("Remote control target must be an object")
        requireOnlyKeys(target, setOf("serial", "label"), "Remote control target")
        val serial = requiredDisplayString(target, "serial")
        val label = requiredDisplayString(target, "label")
        val permissions = when (val value = params.opt("permissions")) {
            null, JSONObject.NULL -> emptySet()
            is org.json.JSONArray -> buildSet<String> {
                repeat(value.length()) { index ->
                    val permission = value.opt(index) as? String
                        ?: throw IllegalArgumentException("Remote permission must be a string")
                    require(permission in SUPPORTED_PERMISSIONS) {
                        "Remote permission is unsupported"
                    }
                    require(add(permission)) { "Remote permission is duplicated" }
                }
            }
            else -> throw IllegalArgumentException("Remote permissions must be an array")
        }

        return RemoteControlOffer(
            host = host,
            port = port,
            token = token.lowercase(Locale.US),
            generation = generation,
            sessionId = sessionId,
            target = RemoteTarget(serial = serial, label = label),
            permissions = permissions,
        )
    }

    fun helloFrame(packageName: String, offer: RemoteControlOffer): ByteArray = encode(
        JSONObject()
            .put("type", "remote_hello")
            .put("protocol", 1)
            .put("package", packageName)
            .put("token", offer.token)
            .put("generation", offer.generation)
            .put("sessionId", offer.sessionId),
    )

    fun videoHelloFrame(packageName: String, offer: RemoteControlOffer): ByteArray = encode(
        JSONObject(String(helloFrame(packageName, offer), UTF_8)).put("channel", "video"),
    )

    fun requestFrame(id: Long, method: String, params: JSONObject = JSONObject()): ByteArray {
        require(id > 0) { "Remote request id must be positive" }
        require(method.matches(Regex("^[a-z][a-z0-9_]{0,63}$"))) {
            "Remote request method is invalid"
        }
        return encode(
            JSONObject()
                .put("type", "remote_request")
                .put("id", id)
                .put("method", method)
                .put("params", params),
        )
    }

    fun parseResponse(payload: ByteArray, expectedId: Long): RemoteControlResponse {
        val response = parseJsonObject(payload)
        requireOnlyKeys(response, setOf("type", "id", "ok", "result", "error"), "Remote response")
        require(response.opt("type") == "remote_response") {
            "Remote response type is invalid"
        }
        val id = parseLong(response.opt("id"), "Remote response id")
        require(id == expectedId) { "Remote response id does not match the request" }
        val ok = response.opt("ok") as? Boolean
            ?: throw IllegalArgumentException("Remote response ok must be a boolean")
        val resultValue = response.opt("result")
        val result = when {
            resultValue == null || resultValue === JSONObject.NULL -> null
            resultValue is JSONObject -> resultValue
            else -> throw IllegalArgumentException("Remote response result must be an object or null")
        }
        val errorValue = response.opt("error")
        val error = when {
            errorValue == null || errorValue === JSONObject.NULL -> null
            errorValue is String && errorValue.length <= 512 -> errorValue
            else -> throw IllegalArgumentException("Remote response error must be a bounded string or null")
        }
        require((ok && result != null && error == null) || (!ok && result == null && !error.isNullOrBlank())) {
            "Remote response success/error fields are inconsistent"
        }
        return RemoteControlResponse(id = id, ok = ok, result = result, error = error)
    }

    private fun normalizePrivateIpv4(value: String): String {
        val octets = value.split('.').map { part ->
            require(part.isNotEmpty() && part.length <= 3 && part.all(Char::isDigit)) {
                "Remote control host must be an IPv4 address"
            }
            part.toIntOrNull()?.takeIf { it in 0..255 }
                ?: throw IllegalArgumentException("Remote control host is invalid")
        }
        require(octets.size == 4) { "Remote control host must be an IPv4 address" }
        val privateAddress =
            octets[0] == 10 ||
                (octets[0] == 172 && octets[1] in 16..31) ||
                (octets[0] == 192 && octets[1] == 168) ||
                octets[0] == 127 ||
                (octets[0] == 169 && octets[1] == 254) ||
                (octets[0] == 100 && octets[1] in 64..127)
        require(privateAddress) { "Remote control host is not on a private network" }
        return octets.joinToString(".")
    }

    private fun requiredString(params: JSONObject, name: String, maxChars: Int): String {
        val value = params.opt(name) as? String
            ?: throw IllegalArgumentException("Remote control $name must be a string")
        require(value.isNotBlank() && value.length <= maxChars && value.none(Char::isISOControl)) {
            "Remote control $name is invalid"
        }
        return value
    }

    private fun requiredDisplayString(params: JSONObject, name: String): String =
        requiredString(params, name, MAX_TARGET_FIELD_CHARS)

    private fun requiredInteger(params: JSONObject, name: String): Int {
        val value = requiredLong(params, name)
        require(value in Int.MIN_VALUE..Int.MAX_VALUE) { "Remote control $name is invalid" }
        return value.toInt()
    }

    private fun requiredLong(params: JSONObject, name: String): Long =
        parseLong(params.opt(name), "Remote control $name")

    private fun parseLong(value: Any?, label: String): Long {
        require(value is Number) { "$label must be an integer" }
        val decimal = runCatching { BigDecimal(value.toString()) }
            .getOrElse { throw IllegalArgumentException("$label must be an integer") }
        val integer = runCatching { decimal.toBigIntegerExact() }
            .getOrElse { throw IllegalArgumentException("$label must be an integer") }
        require(integer in LONG_MIN..LONG_MAX) { "$label is out of range" }
        return integer.toLong()
    }

    private fun parseJsonObject(payload: ByteArray): JSONObject {
        val text = try {
            UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(payload))
                .toString()
        } catch (error: Exception) {
            throw IllegalArgumentException("Remote response must be valid UTF-8", error)
        }
        validateNesting(text)
        return try {
            JSONObject(text)
        } catch (error: Exception) {
            throw IllegalArgumentException("Remote response must be valid JSON", error)
        }
    }

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
                        require(depth <= MAX_JSON_NESTING) { "Remote response nesting is too deep" }
                    }
                    '}', ']' -> if (depth > 0) depth -= 1
                }
            }
        }
    }

    private fun requireOnlyKeys(value: JSONObject, allowed: Set<String>, label: String) {
        require(value.keys().asSequence().all { it in allowed }) { "$label contains unsupported fields" }
    }

    private fun encode(json: JSONObject): ByteArray = json.toString().toByteArray(UTF_8)
}
