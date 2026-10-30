package com.scrcpyguiplus.companion

import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

/** Launcher apps on this phone, and opening one of them, for the desktop's app picker. */
object PhoneApps {
    private const val MAX_PACKAGE_CHARS = 255

    fun list(context: Context): JSONObject {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val packageManager = context.packageManager
        val apps = packageManager.queryIntentActivities(launcher, 0)
            .map { info ->
                info.activityInfo.packageName to info.loadLabel(packageManager).toString()
            }
            .filter { (packageName, _) -> packageName != context.packageName }
            .distinctBy { (packageName, _) -> packageName }
            .sortedBy { (_, label) -> label.lowercase() }
        val array = JSONArray()
        apps.forEach { (packageName, label) ->
            array.put(JSONObject().put("package", packageName).put("label", label))
        }
        return JSONObject().put("apps", array)
    }

    fun parsePackage(params: JSONObject): String {
        val packageName = params.opt("package") as? String
            ?: throw IllegalArgumentException("params.package must be a string")
        require(packageName.length in 1..MAX_PACKAGE_CHARS && PACKAGE_PATTERN.matches(packageName)) {
            "params.package is not a valid package name"
        }
        return packageName
    }

    /**
     * Starting an activity from the background is only allowed to apps with a bound
     * system service, so the Accessibility service's context is preferred when it is on.
     */
    fun launch(context: Context, packageName: String): JSONObject {
        val starter: Context = DeviceControlService.instance ?: context
        val intent = starter.packageManager.getLaunchIntentForPackage(packageName)
            ?: throw IllegalArgumentException("$packageName has no launcher screen")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        starter.startActivity(intent)
        return JSONObject().put("launched", packageName)
    }

    private val PACKAGE_PATTERN = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
}
