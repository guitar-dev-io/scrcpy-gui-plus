package com.scrcpyguiplus.companion

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID
import org.json.JSONObject

/**
 * Receives files from the desktop into Downloads (MediaStore on Android 10+, the app's own
 * Downloads folder before that). One transfer at a time per id; chunks must arrive in order.
 */
class IncomingFiles(private val context: Context) {
    private class Transfer(
        val name: String,
        val size: Long,
        val output: OutputStream,
        val uri: Uri?,
        val file: File?,
        var written: Long = 0,
    )

    private val transfers = mutableMapOf<String, Transfer>()

    @Synchronized
    fun begin(request: FileBegin): JSONObject {
        abortAll()
        val transferId = UUID.randomUUID().toString()
        val transfer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, request.name)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Could not create the file in Downloads")
            val output = resolver.openOutputStream(uri)
                ?: throw IllegalStateException("Could not open the file in Downloads")
            Transfer(request.name, request.size, output, uri, null)
        } else {
            val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: context.filesDir
            directory.mkdirs()
            val file = uniqueFile(directory, request.name)
            Transfer(request.name, request.size, FileOutputStream(file), null, file)
        }
        transfers[transferId] = transfer
        return JSONObject().put("transferId", transferId)
    }

    @Synchronized
    fun chunk(chunk: FileChunk): JSONObject {
        val transfer = transfers[chunk.transferId]
            ?: throw IllegalStateException("Unknown or finished transfer")
        require(chunk.offset == transfer.written) { "Chunk out of order at ${chunk.offset}" }
        require(transfer.written + chunk.bytes.size <= transfer.size) { "More data than announced" }
        transfer.output.write(chunk.bytes)
        transfer.written += chunk.bytes.size
        return JSONObject().put("written", transfer.written)
    }

    @Synchronized
    fun end(transferId: String): JSONObject {
        val transfer = transfers.remove(transferId)
            ?: throw IllegalStateException("Unknown or finished transfer")
        transfer.output.close()
        if (transfer.written != transfer.size) {
            discard(transfer)
            throw IllegalStateException("Transfer incomplete: ${transfer.written} of ${transfer.size} bytes")
        }
        if (transfer.uri != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            context.contentResolver.update(transfer.uri, values, null, null)
        }
        val location = transfer.file?.absolutePath ?: "Download/${transfer.name}"
        return JSONObject().put("saved", location).put("bytes", transfer.written)
    }

    @Synchronized
    fun abortAll() {
        transfers.values.forEach(::discard)
        transfers.clear()
    }

    private fun discard(transfer: Transfer) {
        runCatching { transfer.output.close() }
        transfer.uri?.let { uri -> runCatching { context.contentResolver.delete(uri, null, null) } }
        transfer.file?.let { file -> runCatching { file.delete() } }
    }

    private fun uniqueFile(directory: File, name: String): File {
        var candidate = File(directory, name)
        var index = 1
        val stem = name.substringBeforeLast('.', name)
        val extension = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
        while (candidate.exists()) {
            candidate = File(directory, "$stem ($index)$extension")
            index += 1
        }
        return candidate
    }
}
