package com.scrcpyguiplus.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One desktop this phone has successfully paired with. Recorded alongside the
 * existing single-slot `saveLanOffer`/`loadSavedLanOffer` reconnect state in
 * MainActivity (which still governs automatic reconnect-after-recreation) —
 * this list exists only for the "Trusted Studios" UI and explicit "Forget".
 */
data class TrustedStudio(
    val studioId: String,
    val studioName: String,
    val host: String,
    val port: Int,
    val lastConnectedAt: Long,
)

object TrustedStudios {
    private const val PREFERENCES = "trusted_studios"
    private const val KEY_ENTRIES = "entries"
    private const val MAX_ENTRIES = 20

    fun list(context: Context): List<TrustedStudio> {
        val raw = preferences(context).getString(KEY_ENTRIES, null) ?: return emptyList()
        return runCatching { parse(raw) }.getOrDefault(emptyList())
            .sortedByDescending { it.lastConnectedAt }
    }

    fun upsert(context: Context, studio: TrustedStudio) {
        val next = (listOf(studio) + list(context).filterNot { it.studioId == studio.studioId })
            .take(MAX_ENTRIES)
        save(context, next)
    }

    /**
     * The studio to reconnect to on launch: the most recently used trusted one that just
     * answered discovery. Matches the desktop's stable studio id, or its address for
     * studios trusted before ids existed.
     */
    fun pickAutoConnect(
        found: List<DiscoveredStudio>,
        trusted: List<TrustedStudio>,
    ): DiscoveredStudio? {
        for (studio in trusted.sortedByDescending { it.lastConnectedAt }) {
            val match = found.firstOrNull { candidate ->
                (candidate.studioId != null && candidate.studioId == studio.studioId) ||
                    studio.studioId == "host:${candidate.replyHost}"
            }
            if (match != null) return match
        }
        return null
    }

    fun forget(context: Context, studioId: String) {
        save(context, list(context).filterNot { it.studioId == studioId })
    }

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun save(context: Context, studios: List<TrustedStudio>) {
        val array = JSONArray()
        studios.forEach { studio ->
            array.put(
                JSONObject()
                    .put("studioId", studio.studioId)
                    .put("studioName", studio.studioName)
                    .put("host", studio.host)
                    .put("port", studio.port)
                    .put("lastConnectedAt", studio.lastConnectedAt),
            )
        }
        preferences(context).edit().putString(KEY_ENTRIES, array.toString()).apply()
    }

    private fun parse(raw: String): List<TrustedStudio> {
        val array = JSONArray(raw)
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val studioId = item.optString("studioId").takeIf { it.isNotBlank() }
                ?: return@mapNotNull null
            val host = item.optString("host").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val port = item.optInt("port", -1).takeIf { it in 1..65535 } ?: return@mapNotNull null
            TrustedStudio(
                studioId = studioId,
                studioName = item.optString("studioName").ifBlank { "Unknown Studio" },
                host = host,
                port = port,
                lastConnectedAt = item.optLong("lastConnectedAt", 0L),
            )
        }
    }
}
