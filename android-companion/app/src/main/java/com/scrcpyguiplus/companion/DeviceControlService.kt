package com.scrcpyguiplus.companion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Lets the desktop control this phone without adb. Android only allows input from an
 * accessibility service the user switched on themselves (Settings → Accessibility), so the
 * desktop can ask for control but can never grant it.
 */
class DeviceControlService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun performGesture(request: GestureRequest): Boolean {
        val (width, height) = displaySize()
        val path = Path()
        request.points.forEachIndexed { index, point ->
            val x = (point.x * (width - 1)).coerceIn(0f, (width - 1).toFloat())
            val y = (point.y * (height - 1)).coerceIn(0f, (height - 1).toFloat())
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        val duration = request.durationMs.coerceAtMost(GestureDescription.getMaxGestureDuration())
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, duration))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun performAction(action: String): Boolean {
        if (action == "enter") return pressImeEnter()
        val globalAction = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "power_dialog" -> GLOBAL_ACTION_POWER_DIALOG
            "lock_screen" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                GLOBAL_ACTION_LOCK_SCREEN
            } else {
                throw IllegalStateException("lock_screen needs Android 9 or newer")
            }
            else -> throw IllegalArgumentException("unsupported control action: $action")
        }
        return performGlobalAction(globalAction)
    }

    /** Appends [text] to the focused editable field, the way typing on a keyboard would. */
    fun inputText(text: String): Boolean {
        val node = focusedEditable()
            ?: throw IllegalStateException("Tap a text field on the phone first")
        val current = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
        val updated = current + text
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, updated)
        }
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        if (ok) {
            val cursor = Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, updated.length)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, updated.length)
            }
            node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, cursor)
        }
        return ok
    }

    private fun pressImeEnter(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            throw IllegalStateException("Enter needs Android 11 or newer")
        }
        val node = focusedEditable()
            ?: throw IllegalStateException("Tap a text field on the phone first")
        return node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    private fun focusedEditable(): AccessibilityNodeInfo? =
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }

    private fun displaySize(): Pair<Int, Int> {
        val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            bounds.width() to bounds.height()
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            metrics.widthPixels to metrics.heightPixels
        }
    }

    companion object {
        @Volatile
        var instance: DeviceControlService? = null
            private set

        /** True when the user has switched the service on in Accessibility settings. */
        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val component = ComponentName(context, DeviceControlService::class.java)
            return enabled.split(':').any { entry ->
                ComponentName.unflattenFromString(entry) == component
            }
        }
    }
}
