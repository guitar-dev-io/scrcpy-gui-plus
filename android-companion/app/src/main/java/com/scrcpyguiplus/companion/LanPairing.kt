package com.scrcpyguiplus.companion

import android.net.Uri
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import org.json.JSONObject

data class LanPairingOffer(
    /** The address to dial first. Always the head of [hosts]. */
    val host: String,
    val port: Int,
    /**
     * The one-time token from a pairing QR, or empty for a studio found through LAN
     * discovery. An empty token means the desktop user approves this device instead;
     * see [approvalNonce].
     */
    val token: String,
    val studioId: String? = null,
    val studioName: String? = null,
    /**
     * Every address the desktop advertised, in the order to try them. A desktop on
     * more than one network (Wi-Fi plus Ethernet, or a VPN owning the default route)
     * cannot tell which of its addresses this phone can see, so it sends them all.
     */
    val hosts: List<String> = listOf(host),
    /**
     * Random hex this device sends in place of a token when it was found through
     * discovery. Both sides derive the same six digits from it ([approvalCode]) so the
     * user approving on the desktop can confirm it is this phone.
     */
    val approvalNonce: String? = null,
) {
    val requiresApproval: Boolean get() = token.isEmpty()

    /** The digits to show while waiting, matching what the desktop prompt displays. */
    val approvalCode: String? get() = approvalNonce?.let(LanPairing::approvalCode)
}

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
    private const val MAX_STUDIO_FIELD_CHARS = 64
    private const val MAX_HOST_CANDIDATES = 8
    private const val APPROVAL_NONCE_BYTES = 16
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

        // Optional Trusted Studios identity (doc §5/§12): additive, best-effort.
        // Missing on QR codes from desktop builds older than this field.
        val studioId = uri.getQueryParameter("studioId")?.trim()?.take(MAX_STUDIO_FIELD_CHARS)
            ?.takeIf { it.isNotBlank() }
        val studioName = uri.getQueryParameter("studioName")?.trim()?.take(MAX_STUDIO_FIELD_CHARS)
            ?.takeIf { it.isNotBlank() }

        // Additive on QR codes from newer desktops. A malformed entry is skipped rather
        // than failing the scan: `host` on its own is still a complete offer.
        val extraHosts = uri.getQueryParameter("hosts")
            ?.split(',')
            ?.mapNotNull { candidate ->
                runCatching { normalizeIpv4(candidate.trim()) }.getOrNull()
            }
            ?: emptyList()

        return LanPairingOffer(
            host = host,
            port = port,
            token = tokenValue.lowercase(Locale.US),
            studioId = studioId,
            studioName = studioName,
            hosts = (listOf(host) + extraHosts).distinct().take(MAX_HOST_CANDIDATES),
        )
    }

    /**
     * An offer for a studio found by [LanDiscovery]. Discovery never carries a token, so
     * this offer authenticates by desktop approval and includes a fresh nonce.
     */
    fun discoveredOffer(studio: DiscoveredStudio): LanPairingOffer {
        val hosts = studio.hosts
            .mapNotNull { candidate -> runCatching { normalizeIpv4(candidate) }.getOrNull() }
            .distinct()
            .take(MAX_HOST_CANDIDATES)
        require(hosts.isNotEmpty()) { "This studio did not advertise a reachable address" }
        require(studio.port in 1..65535) { "This studio advertised an invalid port" }

        return LanPairingOffer(
            host = hosts.first(),
            port = studio.port,
            token = "",
            studioId = studio.studioId?.take(MAX_STUDIO_FIELD_CHARS),
            studioName = studio.studioName?.take(MAX_STUDIO_FIELD_CHARS),
            hosts = hosts,
            approvalNonce = newApprovalNonce(),
        )
    }

    fun newApprovalNonce(): String {
        val bytes = ByteArray(APPROVAL_NONCE_BYTES)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { byte -> "%02x".format(byte) }
    }

    /**
     * The six digits the desktop shows for an approval request. Deliberately not a
     * secret: it only lets the user confirm the request came from the phone they hold.
     */
    fun approvalCode(nonce: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray(Charsets.UTF_8))
        var value = 0L
        for (index in 0 until 4) {
            value = (value shl 8) or (digest[index].toLong() and 0xff)
        }
        return (value % 1_000_000L).toString().padStart(6, '0')
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
