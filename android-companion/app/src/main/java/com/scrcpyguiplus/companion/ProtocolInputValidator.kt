package com.scrcpyguiplus.companion

/** Pure field-size validation shared by Android request handlers and JVM tests. */
internal object ProtocolInputValidator {
    const val MAX_CLIPBOARD_TEXT_UTF8_BYTES = 256 * 1024
    const val MAX_URL_UTF8_BYTES = 4096

    fun requireValidClipboardText(text: String) {
        requireUtf8BytesAtMost(
            value = text,
            maxBytes = MAX_CLIPBOARD_TEXT_UTF8_BYTES,
            errorMessage = "params.text must be at most 262144 UTF-8 bytes",
        )
    }

    fun requireValidUrl(url: String) {
        requireUtf8BytesAtMost(
            value = url,
            maxBytes = MAX_URL_UTF8_BYTES,
            errorMessage = "params.url must be at most 4096 UTF-8 bytes",
        )
    }

    private fun requireUtf8BytesAtMost(value: String, maxBytes: Int, errorMessage: String) {
        require(value.toByteArray(Charsets.UTF_8).size <= maxBytes) { errorMessage }
    }
}
