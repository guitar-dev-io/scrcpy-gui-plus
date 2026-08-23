package com.scrcpyguiplus.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolInputValidatorTest {
    @Test
    fun clipboardTextAcceptsExactUtf8ByteLimit() {
        val text = "a".repeat(ProtocolInputValidator.MAX_CLIPBOARD_TEXT_UTF8_BYTES)

        ProtocolInputValidator.requireValidClipboardText(text)
    }

    @Test
    fun clipboardTextRejectsOneByteOverLimit() {
        val text = "a".repeat(ProtocolInputValidator.MAX_CLIPBOARD_TEXT_UTF8_BYTES + 1)

        val error = assertThrows(IllegalArgumentException::class.java) {
            ProtocolInputValidator.requireValidClipboardText(text)
        }

        assertEquals("params.text must be at most 262144 UTF-8 bytes", error.message)
    }

    @Test
    fun clipboardTextCountsMultibyteCharactersAsUtf8Bytes() {
        val text = "é".repeat(ProtocolInputValidator.MAX_CLIPBOARD_TEXT_UTF8_BYTES / 2 + 1)
        assertTrue(text.length < ProtocolInputValidator.MAX_CLIPBOARD_TEXT_UTF8_BYTES)

        val error = assertThrows(IllegalArgumentException::class.java) {
            ProtocolInputValidator.requireValidClipboardText(text)
        }

        assertEquals("params.text must be at most 262144 UTF-8 bytes", error.message)
    }

    @Test
    fun urlAcceptsExactUtf8ByteLimit() {
        val url = "https://" + "a".repeat(ProtocolInputValidator.MAX_URL_UTF8_BYTES - 8)

        ProtocolInputValidator.requireValidUrl(url)
    }

    @Test
    fun urlRejectsOneByteOverLimit() {
        val url = "https://" + "a".repeat(ProtocolInputValidator.MAX_URL_UTF8_BYTES - 7)

        val error = assertThrows(IllegalArgumentException::class.java) {
            ProtocolInputValidator.requireValidUrl(url)
        }

        assertEquals("params.url must be at most 4096 UTF-8 bytes", error.message)
    }

    @Test
    fun urlCountsMultibyteCharactersAsUtf8Bytes() {
        val url = "https://" + "é".repeat((ProtocolInputValidator.MAX_URL_UTF8_BYTES - 8) / 2 + 1)
        assertTrue(url.length < ProtocolInputValidator.MAX_URL_UTF8_BYTES)

        val error = assertThrows(IllegalArgumentException::class.java) {
            ProtocolInputValidator.requireValidUrl(url)
        }

        assertEquals("params.url must be at most 4096 UTF-8 bytes", error.message)
    }
}
