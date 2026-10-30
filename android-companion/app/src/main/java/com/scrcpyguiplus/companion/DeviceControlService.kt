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

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var keepAwakeView: android.view.View? = null

    /**
     * Keeps the display on while the desktop is watching, with a 1x1 invisible overlay
     * that only carries FLAG_KEEP_SCREEN_ON. The power button still locks the phone.
     */
    fun setKeepScreenOn(enabled: Boolean) {
        mainHandler.post {
            val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            if (enabled && keepAwakeView == null) {
                val view = android.view.View(this)
                val params = WindowManager.LayoutParams(
                    1,
                    1,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                    android.graphics.PixelFormat.TRANSLUCENT,
                )
                runCatching { windowManager.addView(view, params) }
                    .onSuccess { keepAwakeView = view }
            } else if (!enabled) {
                keepAwakeView?.let { view -> runCatching { windowManager.removeView(view) } }
                keepAwakeView = null
            }
        }
    }

    override fun onDestroy() {
        setKeepScreenOn(false)
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun performGesture(request: GestureRequest): Boolean {
        val (width, height) = displaySize()
        val duration = request.durationMs.coerceAtMost(GestureDescription.getMaxGestureDuration())
        val builder = GestureDescription.Builder()
        request.strokes.forEach { stroke ->
            val path = Path()
            stroke.forEachIndexed { index, point ->
                val x = (point.x * (width - 1)).coerceIn(0f, (width - 1).toFloat())
                val y = (point.y * (height - 1)).coerceIn(0f, (height - 1).toFloat())
                if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            builder.addStroke(GestureDescription.StrokeDescription(path, 0, duration))
        }
        return dispatchGesture(builder.build(), null, null)
    }

    fun performAction(action: String): Boolean {
        when (action) {
            "enter" -> return pressImeEnter()
            "backspace" -> return deleteLastCharacter()
            "volume_up", "volume_down" -> {
                val audio = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                audio.adjustStreamVolume(
                    android.media.AudioManager.STREAM_MUSIC,
                    if (action == "volume_up") {
                        android.media.AudioManager.ADJUST_RAISE
                    } else {
                        android.media.AudioManager.ADJUST_LOWER
                    },
                    android.media.AudioManager.FLAG_SHOW_UI,
                )
                return true
            }
        }
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

    /** Removes the selection, or the character before the cursor, in the focused field. */
    private fun deleteLastCharacter(): Boolean {
        val node = focusedEditable()
            ?: throw IllegalStateException("Tap a text field on the phone first")
        val current = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
        if (current.isEmpty()) return true
        val start = node.textSelectionStart.takeIf { it >= 0 } ?: current.length
        val end = node.textSelectionEnd.takeIf { it >= 0 } ?: current.length
        val (from, to) = if (start != end) {
            minOf(start, end) to maxOf(start, end)
        } else {
            val cursor = start.coerceIn(0, current.length)
            if (cursor == 0) return true
            current.offsetByCodePoints(cursor, -1) to cursor
        }
        val updated = current.removeRange(from, to)
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, updated)
        }
        val ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        if (ok) {
            val cursor = Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, from)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, from)
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

    /**
     * The current screen as uiautomator-style XML, so the desktop's UI Inspector and
     * Maestro builder can read it without adb. Bounds are scaled to [targetWidth] x
     * [targetHeight] (the size of the frame the desktop is showing) when given.
     */
    fun dumpHierarchyXml(targetWidth: Int?, targetHeight: Int?): String {
        val root = rootInActiveWindow
            ?: throw IllegalStateException("No screen content is available right now")
        val (width, height) = displaySize()
        val scaleX = targetWidth?.toFloat()?.div(width) ?: 1f
        val scaleY = targetHeight?.toFloat()?.div(height) ?: 1f
        val writer = java.io.StringWriter()
        val xml = android.util.Xml.newSerializer()
        xml.setOutput(writer)
        xml.startDocument("UTF-8", true)
        xml.startTag(null, "hierarchy")
        xml.attribute(null, "rotation", "0")
        var budget = UiHierarchyLimits.MAX_NODES
        fun write(node: AccessibilityNodeInfo, index: Int, depth: Int) {
            if (budget-- <= 0 || depth > UiHierarchyLimits.MAX_DEPTH) return
            val bounds = android.graphics.Rect()
            node.getBoundsInScreen(bounds)
            xml.startTag(null, "node")
            xml.attribute(null, "index", index.toString())
            xml.attribute(null, "text", UiHierarchyLimits.clean(node.text))
            xml.attribute(null, "resource-id", node.viewIdResourceName.orEmpty())
            xml.attribute(null, "class", node.className?.toString().orEmpty())
            xml.attribute(null, "package", node.packageName?.toString().orEmpty())
            xml.attribute(null, "content-desc", UiHierarchyLimits.clean(node.contentDescription))
            xml.attribute(null, "checkable", node.isCheckable.toString())
            xml.attribute(null, "checked", node.isChecked.toString())
            xml.attribute(null, "clickable", node.isClickable.toString())
            xml.attribute(null, "enabled", node.isEnabled.toString())
            xml.attribute(null, "focusable", node.isFocusable.toString())
            xml.attribute(null, "focused", node.isFocused.toString())
            xml.attribute(null, "scrollable", node.isScrollable.toString())
            xml.attribute(null, "long-clickable", node.isLongClickable.toString())
            xml.attribute(null, "password", node.isPassword.toString())
            xml.attribute(null, "selected", node.isSelected.toString())
            xml.attribute(
                null,
                "bounds",
                UiHierarchyLimits.bounds(bounds.left, bounds.top, bounds.right, bounds.bottom, scaleX, scaleY),
            )
            for (child in 0 until node.childCount) {
                node.getChild(child)?.let { write(it, child, depth + 1) }
            }
            xml.endTag(null, "node")
        }
        write(root, 0, 0)
        xml.endTag(null, "hierarchy")
        xml.endDocument()
        return writer.toString()
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
