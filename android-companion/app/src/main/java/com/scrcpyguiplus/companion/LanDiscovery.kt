package com.scrcpyguiplus.companion

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import org.json.JSONObject

/** One Mobile Studio desktop that answered a discovery probe on this network. */
data class DiscoveredStudio(
    val studioId: String?,
    val studioName: String?,
    /** Addresses the desktop says it is reachable on, best first. */
    val hosts: List<String>,
    val port: Int,
    /** The address the reply actually came from, which is reachable by definition. */
    val replyHost: String,
    val requiresApproval: Boolean,
) {
    /** What to show the user for this studio: its own name, or the address it answered from. */
    fun label(): String = studioName?.takeIf { it.isNotBlank() } ?: "$replyHost:$port"
}

/**
 * Finds desktops on the local network without a QR code.
 *
 * This exists because a pairing QR can only ever name addresses the desktop *guesses*
 * are reachable. Broadcasting instead inverts that: the reply arrives from an address
 * this phone has demonstrably just received a packet from, so an unreachable QR host
 * stops being a dead end.
 *
 * Discovery is deliberately unauthenticated and carries no token — it only locates a
 * desktop. Connecting to one found this way still needs the desktop user's approval.
 */
object LanDiscovery {
    const val PORT = 47653
    private const val MAGIC = "scrcpy-gui-plus-discovery"
    private const val PROTOCOL = 1
    private const val MAX_DATAGRAM_BYTES = 2 * 1024
    private const val MAX_STUDIOS = 8
    private const val MAX_HOSTS_PER_STUDIO = 8
    private const val SOCKET_POLL_MS = 400
    private const val PROBE_REPEATS = 3
    private const val PROBE_SPACING_MS = 250L

    /**
     * Broadcast a probe and collect replies until [timeoutMs] elapses. Blocking; call
     * from a background thread.
     */
    fun probe(timeoutMs: Int = 2_500, log: (String) -> Unit = {}): List<DiscoveredStudio> {
        val found = LinkedHashMap<String, DiscoveredStudio>()
        val request = JSONObject()
            .put("magic", MAGIC)
            .put("type", "discover")
            .put("v", PROTOCOL)
            .toString()
            .toByteArray(Charsets.UTF_8)

        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = SOCKET_POLL_MS
                val targets = broadcastTargets()
                log("Discovery probing ${targets.size} broadcast address(es) on port $PORT")

                val deadline = System.currentTimeMillis() + timeoutMs
                // Repeat the probe: a single UDP broadcast is allowed to be dropped, and
                // Wi-Fi power saving makes the first one the likeliest to vanish.
                var probesSent = 0
                var nextProbeAt = 0L

                while (System.currentTimeMillis() < deadline && found.size < MAX_STUDIOS) {
                    val now = System.currentTimeMillis()
                    if (probesSent < PROBE_REPEATS && now >= nextProbeAt) {
                        targets.forEach { target ->
                            runCatching {
                                socket.send(
                                    DatagramPacket(request, request.size, target, PORT),
                                )
                            }
                        }
                        probesSent += 1
                        nextProbeAt = now + PROBE_SPACING_MS
                    }

                    val buffer = ByteArray(MAX_DATAGRAM_BYTES)
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    val studio = parseReply(packet) ?: continue
                    // Key on identity when the desktop offers one so the same studio
                    // answering on two interfaces collapses into a single row.
                    val key = studio.studioId ?: "${studio.replyHost}:${studio.port}"
                    found.putIfAbsent(key, studio)
                }
            }
        } catch (error: Exception) {
            log("Discovery failed: ${error.message ?: "unknown error"}")
        }

        log("Discovery finished with ${found.size} studio(s)")
        return found.values.toList()
    }

    /** Internal rather than private so the wire contract can be tested without a socket. */
    internal fun parseReply(packet: DatagramPacket): DiscoveredStudio? {
        val sender = packet.address as? Inet4Address ?: return null
        val replyHost = sender.hostAddress ?: return null
        val json = runCatching {
            JSONObject(String(packet.data, packet.offset, packet.length, Charsets.UTF_8))
        }.getOrNull() ?: return null

        if (json.optString("magic") != MAGIC) return null
        if (json.optString("type") != "studio") return null
        val port = json.optInt("port", 0)
        if (port !in 1..65535) return null

        val advertised = json.optJSONArray("hosts")
        val hosts = buildList {
            // The sender address leads: this phone just received a packet from it, so it
            // is reachable, whatever the desktop believes about its own interfaces.
            add(replyHost)
            if (advertised != null) {
                for (index in 0 until advertised.length()) {
                    val host = advertised.optString(index).trim()
                    if (host.isNotEmpty()) add(host)
                }
            }
        }.distinct().take(MAX_HOSTS_PER_STUDIO)

        return DiscoveredStudio(
            studioId = optionalString(json, "studioId"),
            studioName = optionalString(json, "studioName"),
            hosts = hosts,
            port = port,
            replyHost = replyHost,
            requiresApproval = json.optBoolean("requiresApproval", true),
        )
    }

    /** org.json's optString turns a JSON null into the text "null"; treat it as absent. */
    internal fun optionalString(json: JSONObject, key: String): String? =
        if (json.isNull(key)) null else json.optString(key).trim().takeIf { it.isNotEmpty() }

    /**
     * This device's own IPv4 address on the network it is actually using. Shown on the
     * agent status screen, which previously reported the desktop's address under a
     * "Device Information" heading.
     */
    fun localIpv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces()
            ?.toList()
            ?.asSequence()
            ?.filter { candidate -> candidate.isUp && !candidate.isLoopback }
            ?.flatMap { candidate -> candidate.inetAddresses.toList().asSequence() }
            ?.filterIsInstance<Inet4Address>()
            ?.firstOrNull { address ->
                !address.isLoopbackAddress && !address.isLinkLocalAddress
            }
            ?.hostAddress
    }.getOrNull()

    /**
     * Per-interface broadcast addresses plus the global one. Android routes
     * 255.255.255.255 unpredictably when several interfaces are up, so the directed
     * broadcast for each live IPv4 network is what actually reaches the desktop.
     */
    private fun broadcastTargets(): List<InetAddress> {
        val targets = LinkedHashSet<InetAddress>()
        runCatching {
            NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { candidate ->
                if (!candidate.isUp || candidate.isLoopback) return@forEach
                candidate.interfaceAddresses.forEach { address ->
                    address.broadcast?.let(targets::add)
                }
            }
        }
        runCatching { InetAddress.getByName("255.255.255.255") }
            .getOrNull()
            ?.let(targets::add)
        return targets.toList()
    }
}
