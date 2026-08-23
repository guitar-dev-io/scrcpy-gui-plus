export type AdbShellSuggestionCategory =
  | 'Device'
  | 'Display'
  | 'Apps'
  | 'Input'
  | 'Network'
  | 'Files'
  | 'Performance'
  | 'Diagnostics'

export interface AdbShellSuggestion {
  id: string
  category: AdbShellSuggestionCategory
  label: string
  description: string
  command: string
  keywords?: string
  requiresEdit?: boolean
}

/**
 * Common, read-mostly ADB commands that are useful from the workspace shell.
 * Commands that contain an example package, coordinate, path, or text are
 * marked as templates so the UI can remind the user to edit them first.
 */
export const ADB_SHELL_SUGGESTIONS: readonly AdbShellSuggestion[] = [
  { id: 'device-model', category: 'Device', label: 'Device model', description: 'Show the manufacturer model name', command: 'shell getprop ro.product.model', keywords: 'phone hardware' },
  { id: 'android-version', category: 'Device', label: 'Android version', description: 'Show the installed Android release', command: 'shell getprop ro.build.version.release', keywords: 'os sdk' },
  { id: 'device-serial', category: 'Device', label: 'Device serial', description: 'Read the device serial reported by Android', command: 'shell getprop ro.serialno' },
  { id: 'cpu-abi', category: 'Device', label: 'CPU architecture', description: 'Show the primary CPU ABI', command: 'shell getprop ro.product.cpu.abi', keywords: 'arm x86 architecture' },
  { id: 'all-properties', category: 'Device', label: 'All system properties', description: 'List every Android system property', command: 'shell getprop', keywords: 'build props' },
  { id: 'uptime', category: 'Device', label: 'Device uptime', description: 'Show how long Android has been running', command: 'shell uptime' },

  { id: 'screen-size', category: 'Display', label: 'Screen resolution', description: 'Show physical and overridden display size', command: 'shell wm size', keywords: 'width height resolution' },
  { id: 'screen-density', category: 'Display', label: 'Screen density', description: 'Show physical and overridden DPI', command: 'shell wm density', keywords: 'dpi' },
  { id: 'orientation', category: 'Display', label: 'Current orientation', description: 'Inspect display orientation and rotation', command: 'shell dumpsys input', keywords: 'rotation landscape portrait' },
  { id: 'brightness', category: 'Display', label: 'Screen brightness', description: 'Read the current system brightness value', command: 'shell settings get system screen_brightness', keywords: 'display light' },
  { id: 'screen-timeout', category: 'Display', label: 'Screen timeout', description: 'Read the screen timeout in milliseconds', command: 'shell settings get system screen_off_timeout', keywords: 'sleep' },

  { id: 'packages-all', category: 'Apps', label: 'All packages', description: 'List every installed package', command: 'shell pm list packages', keywords: 'apps installed' },
  { id: 'packages-user', category: 'Apps', label: 'User-installed packages', description: 'List packages installed by the user', command: 'shell pm list packages -3', keywords: 'third party apps' },
  { id: 'foreground-app', category: 'Apps', label: 'Foreground activity', description: 'Show the currently resumed Android activity', command: 'shell dumpsys activity activities', keywords: 'current app resumed' },
  { id: 'package-path', category: 'Apps', label: 'Package APK path', description: 'Replace the example package before running', command: 'shell pm path com.example.app', keywords: 'apk location', requiresEdit: true },
  { id: 'launch-app', category: 'Apps', label: 'Launch an app', description: 'Replace the example package before running', command: 'shell monkey -p com.example.app 1', keywords: 'open start package', requiresEdit: true },
  { id: 'stop-app', category: 'Apps', label: 'Force-stop an app', description: 'Replace the example package before running', command: 'shell am force-stop com.example.app', keywords: 'kill close package', requiresEdit: true },
  { id: 'package-details', category: 'Apps', label: 'Package details', description: 'Inspect permissions, activities, and version data', command: 'shell dumpsys package com.example.app', keywords: 'app info permission version', requiresEdit: true },

  { id: 'key-home', category: 'Input', label: 'Press Home', description: 'Send the Android Home key', command: 'shell input keyevent KEYCODE_HOME', keywords: 'button' },
  { id: 'key-back', category: 'Input', label: 'Press Back', description: 'Send the Android Back key', command: 'shell input keyevent KEYCODE_BACK', keywords: 'button' },
  { id: 'key-recents', category: 'Input', label: 'Open Recents', description: 'Open the recent-apps screen', command: 'shell input keyevent KEYCODE_APP_SWITCH', keywords: 'overview button' },
  { id: 'key-power', category: 'Input', label: 'Press Power', description: 'Send the Android Power key', command: 'shell input keyevent KEYCODE_POWER', keywords: 'button screen' },
  { id: 'key-wakeup', category: 'Input', label: 'Wake screen', description: 'Wake the device display', command: 'shell input keyevent KEYCODE_WAKEUP', keywords: 'screen on' },
  { id: 'tap', category: 'Input', label: 'Tap coordinates', description: 'Replace X and Y with screen coordinates', command: 'shell input tap 500 1000', keywords: 'touch x y', requiresEdit: true },
  { id: 'swipe', category: 'Input', label: 'Swipe gesture', description: 'Edit start/end coordinates and duration (ms)', command: 'shell input swipe 500 1500 500 500 300', keywords: 'scroll gesture', requiresEdit: true },
  { id: 'type-text', category: 'Input', label: 'Type text', description: 'Replace the example; use %s for spaces', command: 'shell input text hello%sworld', keywords: 'keyboard write', requiresEdit: true },

  { id: 'wifi-address', category: 'Network', label: 'Wi-Fi address', description: 'Show wlan0 IP and interface details', command: 'shell ip addr show wlan0', keywords: 'network ip mac' },
  { id: 'routes', category: 'Network', label: 'Network routes', description: 'Show the active routing table', command: 'shell ip route', keywords: 'gateway' },
  { id: 'wifi-status', category: 'Network', label: 'Wi-Fi status', description: 'Inspect Android Wi-Fi service state', command: 'shell dumpsys wifi', keywords: 'ssid signal' },
  { id: 'connectivity', category: 'Network', label: 'Connectivity status', description: 'Inspect active Android networks', command: 'shell dumpsys connectivity', keywords: 'internet mobile wifi' },
  { id: 'ping', category: 'Network', label: 'Ping internet', description: 'Send four packets to test connectivity', command: 'shell ping -c 4 8.8.8.8', keywords: 'network test' },

  { id: 'list-sdcard', category: 'Files', label: 'List shared storage', description: 'List files at the shared-storage root', command: 'shell ls -la /sdcard', keywords: 'files folders storage' },
  { id: 'list-downloads', category: 'Files', label: 'List Downloads', description: 'List files in the Android Downloads folder', command: 'shell ls -la /sdcard/Download', keywords: 'files' },
  { id: 'storage-usage', category: 'Files', label: 'Storage usage', description: 'Show free and used space by filesystem', command: 'shell df -h', keywords: 'disk free' },
  { id: 'folder-size', category: 'Files', label: 'Folder size', description: 'Edit the path to inspect another folder', command: 'shell du -sh /sdcard/Download', keywords: 'disk directory', requiresEdit: true },

  { id: 'battery', category: 'Performance', label: 'Battery status', description: 'Show level, temperature, charging, and health', command: 'shell dumpsys battery', keywords: 'power charge' },
  { id: 'memory', category: 'Performance', label: 'Memory summary', description: 'Show system RAM totals and availability', command: 'shell cat /proc/meminfo', keywords: 'ram' },
  { id: 'top', category: 'Performance', label: 'CPU snapshot', description: 'Show one snapshot of running processes', command: 'shell top -n 1', keywords: 'cpu process performance' },
  { id: 'processes', category: 'Performance', label: 'All processes', description: 'List Android processes', command: 'shell ps -A', keywords: 'pid apps' },
  { id: 'app-memory', category: 'Performance', label: 'App memory details', description: 'Replace the example package before running', command: 'shell dumpsys meminfo com.example.app', keywords: 'ram package', requiresEdit: true },

  { id: 'recent-logcat', category: 'Diagnostics', label: 'Recent Logcat', description: 'Print the most recent 200 log messages', command: 'logcat -d -t 200', keywords: 'logs errors debug' },
  { id: 'errors-logcat', category: 'Diagnostics', label: 'Error Logcat', description: 'Print recent error-level log messages', command: 'logcat -d -t 200 *:E', keywords: 'logs crash' },
  { id: 'window-state', category: 'Diagnostics', label: 'Window state', description: 'Inspect Android windows and focus', command: 'shell dumpsys window windows', keywords: 'activity focus display' },
  { id: 'activity-services', category: 'Diagnostics', label: 'Running services', description: 'Inspect services managed by ActivityManager', command: 'shell dumpsys activity services', keywords: 'background apps' },
  { id: 'system-services', category: 'Diagnostics', label: 'System services', description: 'List services registered with Android', command: 'shell service list', keywords: 'binder' },
]

export function filterAdbShellSuggestions(
  query: string,
  suggestions: readonly AdbShellSuggestion[] = ADB_SHELL_SUGGESTIONS,
): AdbShellSuggestion[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...suggestions]

  return suggestions.filter((suggestion) => {
    const haystack = [
      suggestion.label,
      suggestion.description,
      suggestion.command,
      suggestion.category,
      suggestion.keywords ?? '',
    ].join(' ').toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
