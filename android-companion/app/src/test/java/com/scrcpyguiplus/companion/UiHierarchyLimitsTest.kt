package com.scrcpyguiplus.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class UiHierarchyLimitsTest {
    @Test
    fun scalesBoundsToTheDesktopFrame() {
        assertEquals("[0,0][540,1200]", UiHierarchyLimits.bounds(0, 0, 1080, 2400, 0.5f, 0.5f))
        assertEquals("[10,20][30,40]", UiHierarchyLimits.bounds(10, 20, 30, 40, 1f, 1f))
    }

    @Test
    fun stripsXmlInvalidControlCharacters() {
        assertEquals("ab\nc", UiHierarchyLimits.clean("a\u0000b\nc\u0007"))
        assertEquals("", UiHierarchyLimits.clean(null))
    }

    @Test
    fun parsesOptionalTargetSize() {
        assertEquals(720, UiHierarchyLimits.parseTarget(JSONObject().put("w", 720), "w"))
        assertNull(UiHierarchyLimits.parseTarget(JSONObject(), "w"))
        assertThrows(IllegalArgumentException::class.java) {
            UiHierarchyLimits.parseTarget(JSONObject().put("w", 0), "w")
        }
    }
}
