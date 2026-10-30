package com.scrcpyguiplus.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceControlProtocolTest {
    @Test
    fun parsesTapAndSwipeGestures() {
        val tap = DeviceControlProtocol.parseGesture(
            JSONObject("""{"points":[[0.5,0.25]],"durationMs":60}"""),
        )
        assertEquals(listOf(NormalizedPoint(0.5f, 0.25f)), tap.points)
        assertEquals(60L, tap.durationMs)

        val swipe = DeviceControlProtocol.parseGesture(
            JSONObject("""{"points":[[0,1],[0.5,0.5],[1,0]],"durationMs":300}"""),
        )
        assertEquals(3, swipe.points.size)
        assertEquals(NormalizedPoint(1f, 0f), swipe.points.last())
    }

    @Test
    fun rejectsOutOfRangeOrMalformedGestures() {
        val invalid = listOf(
            """{"points":[],"durationMs":60}""",
            """{"points":[[1.5,0.2]],"durationMs":60}""",
            """{"points":[[-0.1,0.2]],"durationMs":60}""",
            """{"points":[[0.1]],"durationMs":60}""",
            """{"points":[["a",0.2]],"durationMs":60}""",
            """{"points":[[0.1,0.2]],"durationMs":0}""",
            """{"points":[[0.1,0.2]],"durationMs":20000}""",
            """{"points":[[0.1,0.2]]}""",
        )
        invalid.forEach { json ->
            assertThrows(json, IllegalArgumentException::class.java) {
                DeviceControlProtocol.parseGesture(JSONObject(json))
            }
        }
        val tooMany = (0..DeviceControlProtocol.MAX_GESTURE_POINTS).joinToString(",") { "[0.1,0.1]" }
        assertThrows(IllegalArgumentException::class.java) {
            DeviceControlProtocol.parseGesture(JSONObject("""{"points":[$tooMany],"durationMs":60}"""))
        }
    }

    @Test
    fun acceptsOnlyKnownActions() {
        assertEquals("home", DeviceControlProtocol.parseAction(JSONObject("""{"action":"home"}""")))
        assertThrows(IllegalArgumentException::class.java) {
            DeviceControlProtocol.parseAction(JSONObject("""{"action":"factory_reset"}"""))
        }
    }

    @Test
    fun boundsText() {
        assertEquals("hi", DeviceControlProtocol.parseText(JSONObject("""{"text":"hi"}""")))
        assertThrows(IllegalArgumentException::class.java) {
            DeviceControlProtocol.parseText(JSONObject("""{"text":""}"""))
        }
        val big = "x".repeat(DeviceControlProtocol.MAX_TEXT_UTF8_BYTES + 1)
        assertThrows(IllegalArgumentException::class.java) {
            DeviceControlProtocol.parseText(JSONObject().put("text", big))
        }
    }

    @Test
    fun parsesTwoFingerStrokesForPinch() {
        val pinch = DeviceControlProtocol.parseGesture(
            JSONObject("""{"strokes":[[[0.4,0.5],[0.2,0.5]],[[0.6,0.5],[0.8,0.5]]],"durationMs":250}"""),
        )
        assertEquals(2, pinch.strokes.size)
        assertEquals(NormalizedPoint(0.8f, 0.5f), pinch.strokes[1].last())
        assertThrows(IllegalArgumentException::class.java) {
            DeviceControlProtocol.parseGesture(
                JSONObject("""{"strokes":[[[0.1,0.1]],[[0.2,0.2]],[[0.3,0.3]]],"durationMs":250}"""),
            )
        }
    }

    @Test
    fun acceptsEditingAndVolumeActions() {
        listOf("backspace", "volume_up", "volume_down").forEach { action ->
            assertEquals(action, DeviceControlProtocol.parseAction(JSONObject().put("action", action)))
        }
    }
}
