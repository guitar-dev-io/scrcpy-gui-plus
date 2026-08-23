package com.scrcpyguiplus.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteReconnectTest {
    @Test
    fun exponentialBackoffIsCappedAndDeterministicAtCenteredJitter() {
        val policy = RemoteReconnectPolicy(
            initialDelayMs = 100,
            maximumDelayMs = 500,
            windowMs = 1_000,
            jitterRatio = 0.2,
        )
        assertEquals(100, policy.delayMs(1, 0.5))
        assertEquals(200, policy.delayMs(2, 0.5))
        assertEquals(400, policy.delayMs(3, 0.5))
        assertEquals(500, policy.delayMs(4, 0.5))
        assertEquals(400, policy.delayMs(4, 0.0))
        assertEquals(500, policy.delayMs(4, 1.0))
    }
}
