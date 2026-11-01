package com.scrcpyguiplus.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LanDiscoveryOptionalStringTest {
    @Test
    fun treatsJsonNullAndBlankAsAbsent() {
        val json = JSONObject("""{"studioName":null,"studioId":"  ","host":" Mac "}""")
        assertNull(LanDiscovery.optionalString(json, "studioName"))
        assertNull(LanDiscovery.optionalString(json, "studioId"))
        assertNull(LanDiscovery.optionalString(json, "missing"))
        assertEquals("Mac", LanDiscovery.optionalString(json, "host"))
    }
}
