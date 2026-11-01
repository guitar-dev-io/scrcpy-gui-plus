package com.scrcpyguiplus.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrustedStudiosAutoConnectTest {
    private fun found(id: String?, host: String) = DiscoveredStudio(
        studioId = id,
        studioName = "Mac",
        hosts = listOf(host),
        port = 5000,
        replyHost = host,
        requiresApproval = true,
    )

    private fun trusted(id: String, at: Long) = TrustedStudio(
        studioId = id,
        studioName = "Mac",
        host = "192.168.1.2",
        port = 5000,
        lastConnectedAt = at,
    )

    @Test
    fun picksMostRecentTrustedStudioThatAnswered() {
        val office = found("studio-office", "192.168.1.2")
        val home = found("studio-home", "192.168.1.3")
        val picked = TrustedStudios.pickAutoConnect(
            listOf(office, home),
            listOf(trusted("studio-office", 1), trusted("studio-home", 5)),
        )
        assertEquals(home, picked)
    }

    @Test
    fun matchesStudiosTrustedByAddress() {
        val legacy = found(null, "192.168.1.9")
        assertEquals(
            legacy,
            TrustedStudios.pickAutoConnect(listOf(legacy), listOf(trusted("host:192.168.1.9", 1))),
        )
    }

    @Test
    fun ignoresUnknownStudios() {
        assertNull(
            TrustedStudios.pickAutoConnect(
                listOf(found("stranger", "192.168.1.50")),
                listOf(trusted("studio-office", 1)),
            ),
        )
    }
}
