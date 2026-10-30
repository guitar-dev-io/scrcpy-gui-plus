package com.scrcpyguiplus.companion

import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FileTransferProtocolTest {
    @Test
    fun keepsOnlyAPlainFileName() {
        assertEquals("report.pdf", FileTransferProtocol.sanitizeName("/Users/me/report.pdf"))
        assertEquals("evil.sh", FileTransferProtocol.sanitizeName("..\\..\\evil.sh"))
        assertEquals("hidden", FileTransferProtocol.sanitizeName(".hidden"))
        assertEquals("a_b_c", FileTransferProtocol.sanitizeName("a:b*c"))
        assertEquals("file", FileTransferProtocol.sanitizeName("   "))
        assertEquals("รูปภาพ.png", FileTransferProtocol.sanitizeName("รูปภาพ.png"))
    }

    @Test
    fun boundsFileSizeAndChunks() {
        val begin = FileTransferProtocol.parseBegin(JSONObject("""{"name":"a.txt","size":5}"""))
        assertEquals(5L, begin.size)
        assertThrows(IllegalArgumentException::class.java) {
            FileTransferProtocol.parseBegin(JSONObject().put("name", "big").put("size", 2L * 1024 * 1024 * 1024))
        }
        val data = Base64.getEncoder().encodeToString("hello".toByteArray())
        val chunk = FileTransferProtocol.parseChunk(
            JSONObject().put("transferId", "t1").put("offset", 0).put("data", data),
        )
        assertArrayEquals("hello".toByteArray(), chunk.bytes)
        assertThrows(IllegalArgumentException::class.java) {
            FileTransferProtocol.parseChunk(JSONObject().put("transferId", "t1").put("offset", 0).put("data", "%%%"))
        }
    }

    @Test
    fun validatesPackageNames() {
        assertEquals("com.android.chrome", PhoneApps.parsePackage(JSONObject().put("package", "com.android.chrome")))
        assertThrows(IllegalArgumentException::class.java) {
            PhoneApps.parsePackage(JSONObject().put("package", "chrome; rm -rf"))
        }
    }
}
