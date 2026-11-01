package com.scrcpyguiplus.companion

import java.util.Base64
import org.json.JSONObject

data class FileBegin(val name: String, val size: Long)

data class FileChunk(val transferId: String, val offset: Long, val bytes: ByteArray)

/**
 * Validation for desktop → phone file transfers (`file_begin`, `file_chunk`, `file_end`).
 * Chunks are base64 so they fit the JSON request frames; JVM-testable on purpose.
 */
object FileTransferProtocol {
    const val MAX_FILE_BYTES = 1024L * 1024 * 1024
    const val MAX_CHUNK_BYTES = 512 * 1024
    private const val MAX_NAME_CHARS = 120

    fun parseBegin(params: JSONObject): FileBegin {
        val rawName = params.opt("name") as? String
            ?: throw IllegalArgumentException("params.name must be a string")
        val size = (params.opt("size") as? Number)?.toLong()
            ?: throw IllegalArgumentException("params.size must be a number")
        require(size in 0..MAX_FILE_BYTES) { "Files up to 1 GB can be sent" }
        return FileBegin(sanitizeName(rawName), size)
    }

    fun parseChunk(params: JSONObject): FileChunk {
        val transferId = parseTransferId(params)
        val offset = (params.opt("offset") as? Number)?.toLong()
            ?: throw IllegalArgumentException("params.offset must be a number")
        val data = params.opt("data") as? String
            ?: throw IllegalArgumentException("params.data must be a base64 string")
        val bytes = try {
            Base64.getDecoder().decode(data)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("params.data is not valid base64")
        }
        require(bytes.size in 1..MAX_CHUNK_BYTES) { "A chunk must be 1 to $MAX_CHUNK_BYTES bytes" }
        return FileChunk(transferId, offset, bytes)
    }

    fun parseTransferId(params: JSONObject): String {
        val id = params.opt("transferId") as? String
            ?: throw IllegalArgumentException("params.transferId must be a string")
        require(id.isNotBlank() && id.length <= 64) { "params.transferId is invalid" }
        return id
    }

    /** Keeps only a plain file name: no folders, no control characters, no leading dots. */
    fun sanitizeName(raw: String): String {
        val base = raw.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = base
            .map { char -> if (char.isISOControl() || char in "<>:\"|?*") '_' else char }
            .joinToString("")
            .trim()
            .trimStart('.')
            .take(MAX_NAME_CHARS)
        return cleaned.ifBlank { "file" }
    }
}
