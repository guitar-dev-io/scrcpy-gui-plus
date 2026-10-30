package com.scrcpyguiplus.companion

import org.json.JSONArray
import org.json.JSONObject

/** One gesture point in display-relative coordinates: (0, 0) top-left, (1, 1) bottom-right. */
data class NormalizedPoint(val x: Float, val y: Float)

/** A single-finger stroke: one point is a tap (or long press with a long duration). */
data class GestureRequest(val points: List<NormalizedPoint>, val durationMs: Long)

/**
 * Pure validation for the desktop → phone control methods (`control_gesture`,
 * `control_action`, `control_text`). Kept free of Android types so it runs in JVM tests;
 * [DeviceControlService] turns the parsed values into real input.
 */
object DeviceControlProtocol {
    const val MAX_GESTURE_POINTS = 256
    const val MIN_GESTURE_DURATION_MS = 1L
    const val MAX_GESTURE_DURATION_MS = 10_000L
    const val MAX_TEXT_UTF8_BYTES = 4096

    val GLOBAL_ACTIONS: Set<String> = setOf(
        "back",
        "home",
        "recents",
        "notifications",
        "quick_settings",
        "power_dialog",
        "lock_screen",
        "enter",
    )

    fun parseGesture(params: JSONObject): GestureRequest {
        val rawPoints = params.opt("points") as? JSONArray
            ?: throw IllegalArgumentException("params.points must be an array")
        require(rawPoints.length() in 1..MAX_GESTURE_POINTS) {
            "params.points must contain 1 to $MAX_GESTURE_POINTS points"
        }
        val points = (0 until rawPoints.length()).map { index ->
            val pair = rawPoints.opt(index) as? JSONArray
                ?: throw IllegalArgumentException("params.points[$index] must be [x, y]")
            require(pair.length() == 2) { "params.points[$index] must be [x, y]" }
            NormalizedPoint(
                x = normalizedCoordinate(pair.opt(0), "params.points[$index][0]"),
                y = normalizedCoordinate(pair.opt(1), "params.points[$index][1]"),
            )
        }
        val duration = params.opt("durationMs") as? Number
            ?: throw IllegalArgumentException("params.durationMs must be a number")
        val durationMs = duration.toLong()
        require(durationMs in MIN_GESTURE_DURATION_MS..MAX_GESTURE_DURATION_MS) {
            "params.durationMs must be between $MIN_GESTURE_DURATION_MS and $MAX_GESTURE_DURATION_MS"
        }
        return GestureRequest(points, durationMs)
    }

    fun parseAction(params: JSONObject): String {
        val action = params.opt("action") as? String
            ?: throw IllegalArgumentException("params.action must be a string")
        require(action in GLOBAL_ACTIONS) { "unsupported control action: ${action.take(40)}" }
        return action
    }

    fun parseText(params: JSONObject): String {
        val text = params.opt("text") as? String
            ?: throw IllegalArgumentException("params.text must be a string")
        require(text.isNotEmpty()) { "params.text must not be empty" }
        require(text.toByteArray(Charsets.UTF_8).size <= MAX_TEXT_UTF8_BYTES) {
            "params.text must be at most $MAX_TEXT_UTF8_BYTES UTF-8 bytes"
        }
        return text
    }

    private fun normalizedCoordinate(value: Any?, field: String): Float {
        val number = value as? Number ?: throw IllegalArgumentException("$field must be a number")
        val coordinate = number.toDouble()
        require(coordinate.isFinite() && coordinate in 0.0..1.0) { "$field must be between 0 and 1" }
        return coordinate.toFloat()
    }
}
