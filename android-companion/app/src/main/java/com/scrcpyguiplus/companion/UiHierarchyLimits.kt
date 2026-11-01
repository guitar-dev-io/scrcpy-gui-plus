package com.scrcpyguiplus.companion

import kotlin.math.roundToInt

/** Pure helpers for the uiautomator-style dump, kept separate so JVM tests can cover them. */
object UiHierarchyLimits {
    const val MAX_NODES = 4000
    const val MAX_DEPTH = 60
    private const val MAX_TEXT_CHARS = 500

    /** Text for an XML attribute: no control characters (invalid in XML 1.0), bounded. */
    fun clean(value: CharSequence?): String =
        value?.toString()
            ?.filter { char -> char == '\t' || char == '\n' || char >= ' ' }
            ?.take(MAX_TEXT_CHARS)
            .orEmpty()

    /** uiautomator's "[left,top][right,bottom]", scaled to the frame the desktop shows. */
    fun bounds(left: Int, top: Int, right: Int, bottom: Int, scaleX: Float, scaleY: Float): String =
        "[${(left * scaleX).roundToInt()},${(top * scaleY).roundToInt()}]" +
            "[${(right * scaleX).roundToInt()},${(bottom * scaleY).roundToInt()}]"

    fun parseTarget(params: org.json.JSONObject, key: String): Int? {
        val value = params.opt(key) as? Number ?: return null
        val size = value.toInt()
        require(size in 1..8192) { "params.$key must be between 1 and 8192" }
        return size
    }
}
