package com.scrcpyguiplus.companion

import android.content.Context
import java.util.UUID

/**
 * A random identity generated once per app install and persisted in its own
 * SharedPreferences, independent of the desktop's connection-scoped device id
 * (`lan-<generation>-<ip>` / `aoa-<bus>-<addr>`) and independent of the ADB
 * serial/IP, which both change across reconnects. Sent as `deviceId` in the
 * hello frame so the desktop can recognize this phone across sessions.
 */
object AgentIdentity {
    private const val PREFERENCES = "agent_identity"
    private const val KEY_DEVICE_ID = "deviceId"

    fun deviceId(context: Context): String {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val existing = preferences.getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrBlank()) return existing

        val generated = UUID.randomUUID().toString()
        preferences.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }
}
