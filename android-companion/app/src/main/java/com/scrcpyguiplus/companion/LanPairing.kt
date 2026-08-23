package com.scrcpyguiplus.companion

import android.net.Uri
import java.util.Locale
import org.json.JSONObject

data class LanPairingOffer(
    val host: String,
    val port: Int,
    val token: String,
)

data class ScreenStreamOffer(
    val host: String,
    val port: Int,
    val token: String,
    val generation: Long,
    val maxWidth: Int,
    val maxHeight: Int,
    val maxFps: Int,
    val jpegQuality: Int,
)

/** Strict parser for one-time desktop LAN pairing QR/manual payloads. */
object LanPairing {
    private const val SCHEME = "scrcpy-gui-plus"
    private const val AUTHORITY = "pair"
    private const val VERSION = "1"
    private const val MAX_PAYLOAD_CHARS = 4096
    private val tokenPattern = Regex("^[0-9a-fA-F]{64}$")

    fun parse(payload: String): LanPairingOffer {
        val trimmed = payload.trim()
        require(trimmed.isNotEmpty()) { "Pairing code is empty" }
        require(trimmed.length <= MAX_PAYLOAD_CHARS) { "Pairing code is too long" }

        val uri = Uri.parse(trimmed)
        require(uri.scheme == SCHEME && uri.host == AUTHORITY) {
            "This is not a Scrcpy GUI Plus pairing code"
        }
        require(uri.getQueryParameters("v") == listOf(VERSION)) {
            "Unsupported pairing code version"
        }
        val hostValue = uri.singleQueryValue("host")
        val portValue = uri.singleQueryValue("port")
        val tokenValue = uri.singleQueryValue("token")
        val host = normalizeIpv4(hostValue)
        val port = portValue.toIntOrNull()
        require(port != null && port in 1..65535) { "Pairing port is invalid" }
        require(tokenPattern.matches(tokenValue)) { "Pairing token is invalid" }

        return LanPairingOffer(
            host = host,
            port = port,
            token = tokenValue.lowercase(Locale.US),
        )
    }

    fun parseScreenOffer(params: JSONObject): ScreenStreamOffer {
        val host = normalizeIpv4(params.optString("host", ""))
        val port = params.opt("port") as? Number
        require(port != null && port.toLong() in 1..65535) {
            "Screen stream port is invalid"
        }
        val token = params.optString("token", "")
        require(tokenPattern.matches(token)) { "Screen stream token is invalid" }
        val generation = params.opt("generation") as? Number
        require(generation != null && generation.toLong() > 0) {
            "Screen stream generation is invalid"
        }

        return ScreenStreamOffer(
            host = host,
            port = port.toInt(),
            token = token.lowercase(Locale.US),
            generation = generation.toLong(),
            maxWidth = boundedInt(params, "maxWidth", 1280, 320..1920),
            maxHeight = boundedInt(params, "maxHeight", 1280, 320..1920),
            maxFps = boundedInt(params, "maxFps", 12, 1..30),
            jpegQuality = boundedInt(params, "jpegQuality", 60, 35..85),
        )
    }

    private fun boundedInt(
        params: JSONObject,
        name: String,
        default: Int,
        range: IntRange,
    ): Int {
        if (!params.has(name)) return default
        val value = params.opt(name) as? Number
            ?: throw IllegalArgumentException("Screen stream $name is invalid")
        val integer = value.toLong()
        require(value.toDouble() == integer.toDouble() && integer in range.first..range.last) {
            "Screen stream $name is invalid"
        }
        return integer.toInt()
    }

    private fun Uri.singleQueryValue(name: String): String {
        val values = getQueryParameters(name)
        require(values.size == 1 && values[0].isNotBlank()) {
            "Pairing code is missing $name"
        }
        return values[0]
    }

    private fun normalizeIpv4(value: String): String {
        val octets = value.split('.')
        require(octets.size == 4) { "Pairing host must be an IPv4 address" }
        val normalized = octets.map { part ->
            require(part.isNotEmpty() && part.length <= 3 && part.all(Char::isDigit)) {
                "Pairing host is invalid"
            }
            val octet = part.toIntOrNull()
            require(octet != null && octet in 0..255) { "Pairing host is invalid" }
            octet
        }
        return normalized.joinToString(".")
    }
}
