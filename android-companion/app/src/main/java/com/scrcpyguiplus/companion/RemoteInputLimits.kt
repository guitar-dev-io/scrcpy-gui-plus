package com.scrcpyguiplus.companion

object RemoteInputLimits {
    const val TEXT_UTF8_BYTES = 300
    const val CLIPBOARD_UTF8_BYTES = 2 * 1024

    fun isTextAllowed(value: String): Boolean = utf8Size(value) <= TEXT_UTF8_BYTES
    fun isClipboardAllowed(value: String): Boolean = utf8Size(value) <= CLIPBOARD_UTF8_BYTES
    fun utf8Size(value: String): Int = value.toByteArray(Charsets.UTF_8).size
}
