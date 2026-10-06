package com.scrcpyguiplus.companion

import java.net.DatagramPacket
import java.net.InetAddress
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Covers the discovery/approval pairing path, which has no token to check and therefore
 * depends entirely on both sides deriving the same confirmation digits.
 *
 * `LanPairing.parse` is not exercised here: it needs `android.net.Uri`, which is not
 * available to plain JVM unit tests.
 */
class LanPairingApprovalTest {
    @Test
    fun approvalCodeMatchesTheDesktopDerivation() {
        // The desktop computes this from the first four bytes of SHA-256(nonce), big-endian,
        // modulo one million. A drift here makes the two prompts disagree and the user
        // rightly refuses to approve, so the expected value is pinned rather than derived.
        assertEquals("018321", LanPairing.approvalCode("0123456789abcdef"))
        assertEquals("018321", LanPairing.approvalCode("0123456789abcdef"))
    }

    @Test
    fun approvalCodeIsAlwaysSixDigits() {
        repeat(200) {
            val code = LanPairing.approvalCode(LanPairing.newApprovalNonce())
            assertEquals("padded to six digits: $code", 6, code.length)
            assertTrue(code.all(Char::isDigit))
        }
    }

    @Test
    fun approvalNonceStaysInsideTheRangeTheDesktopAccepts() {
        val nonce = LanPairing.newApprovalNonce()

        // The desktop rejects a nonce outside 16..64 hex characters.
        assertTrue("length was ${nonce.length}", nonce.length in 16..64)
        assertTrue(nonce.all { character -> character in "0123456789abcdef" })
        assertFalse("nonces must not repeat", nonce == LanPairing.newApprovalNonce())
    }

    @Test
    fun discoveredOfferLeadsWithTheAddressThatAnsweredAndAsksForApproval() {
        val offer = LanPairing.discoveredOffer(
            DiscoveredStudio(
                studioId = "studio-1",
                studioName = "Desk",
                hosts = listOf("192.168.1.43", "10.0.0.5", "192.168.1.43"),
                port = 44_100,
                replyHost = "192.168.1.43",
                requiresApproval = true,
            ),
        )

        assertEquals("192.168.1.43", offer.host)
        assertEquals(listOf("192.168.1.43", "10.0.0.5"), offer.hosts)
        assertEquals(44_100, offer.port)
        assertTrue(offer.requiresApproval)
        assertEquals(LanPairing.approvalCode(offer.approvalNonce!!), offer.approvalCode)
    }

    @Test
    fun discoveredOfferRejectsAnAdvertisementItCannotDial() {
        val unusable = listOf(
            DiscoveredStudio(null, null, listOf("not-an-ip", "999.1.1.1"), 44_100, "1.2.3.4", true),
            DiscoveredStudio(null, null, emptyList(), 44_100, "1.2.3.4", true),
            DiscoveredStudio(null, null, listOf("192.168.1.43"), 0, "1.2.3.4", true),
            DiscoveredStudio(null, null, listOf("192.168.1.43"), 70_000, "1.2.3.4", true),
        )

        unusable.forEach { studio ->
            assertThrows(IllegalArgumentException::class.java) {
                LanPairing.discoveredOffer(studio)
            }
        }
    }

    @Test
    fun discoveryReplyPutsTheSenderAddressAheadOfWhatTheDesktopAdvertised() {
        val reply = JSONObject()
            .put("magic", "scrcpy-gui-plus-discovery")
            .put("type", "studio")
            .put("v", 1)
            .put("port", 44_100)
            .put("hosts", listOf("10.0.0.5", "192.168.1.43").toJsonArray())
            .put("studioId", "studio-1")
            .put("studioName", "Desk")
            .put("requiresApproval", true)

        val studio = LanDiscovery.parseReply(packetFrom("192.168.1.43", reply.toString()))

        requireNotNull(studio)
        // The reply demonstrably reached this device from the sender address, so it leads
        // regardless of the order the desktop listed its own interfaces in.
        assertEquals("192.168.1.43", studio.hosts.first())
        assertEquals(listOf("192.168.1.43", "10.0.0.5"), studio.hosts)
        assertEquals("Desk", studio.label())
        assertEquals(44_100, studio.port)
        assertTrue(studio.requiresApproval)
    }

    @Test
    fun discoveryIgnoresRepliesThatAreNotFromAStudio() {
        val rejected = listOf(
            "not json at all",
            JSONObject().put("type", "studio").put("port", 44_100).toString(),
            JSONObject().put("magic", "someone-else").put("type", "studio").put("port", 44_100)
                .toString(),
            JSONObject().put("magic", "scrcpy-gui-plus-discovery").put("type", "discover")
                .put("port", 44_100).toString(),
            JSONObject().put("magic", "scrcpy-gui-plus-discovery").put("type", "studio")
                .put("port", 0).toString(),
            JSONObject().put("magic", "scrcpy-gui-plus-discovery").put("type", "studio")
                .put("port", 70_000).toString(),
        )

        rejected.forEach { payload ->
            assertNull(payload, LanDiscovery.parseReply(packetFrom("192.168.1.43", payload)))
        }
    }

    @Test
    fun aStudioWithoutANameFallsBackToTheAddressItAnsweredFrom() {
        val reply = JSONObject()
            .put("magic", "scrcpy-gui-plus-discovery")
            .put("type", "studio")
            .put("port", 44_100)

        val studio = LanDiscovery.parseReply(packetFrom("192.168.1.43", reply.toString()))

        requireNotNull(studio)
        assertEquals("192.168.1.43:44100", studio.label())
        assertEquals(listOf("192.168.1.43"), studio.hosts)
    }

    private fun packetFrom(host: String, payload: String): DatagramPacket {
        val bytes = payload.toByteArray(Charsets.UTF_8)
        return DatagramPacket(bytes, bytes.size, InetAddress.getByName(host), LanDiscovery.PORT)
    }

    private fun List<String>.toJsonArray() =
        org.json.JSONArray().also { array -> forEach(array::put) }
}
