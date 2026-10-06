import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  ChevronLeft,
  Home,
  Pin,
  PinOff,
  Play,
  RotateCw,
  Square,
  SquareStack,
} from 'lucide-react'
import { ActionRail, type RailGroup } from '../device-rail'
import { useDeviceScreen } from '../embedded-workspace/DeviceScreen'
import {
  settingsToOptions,
  useEmbeddedWorkspaceSettings,
} from '../../hooks/useEmbeddedWorkspaceSettings'
import { isTauri } from '../../utils/tauriEnv'
import type { MirrorWindowTarget } from '../../windows/mirrorWindow'

interface MirrorWindowAppProps {
  target: MirrorWindowTarget
}

/**
 * Root component of a detached mirror window.
 *
 * It renders only the device surface and its controls — no sidebar, header, or
 * routing — because this webview exists solely to host one device. The session
 * is driven through the same `useDeviceScreen` engine the dashboard uses, so it
 * attaches to the device session already running in the main window rather than
 * starting a second scrcpy-server.
 */
export default function MirrorWindowApp({ target }: MirrorWindowAppProps) {
  const { serial, deviceName, customPath } = target
  const { settings } = useEmbeddedWorkspaceSettings()
  const options = useMemo(() => settingsToOptions(settings), [settings])
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [railExpanded, setRailExpanded] = useState(false)
  const [notice, setNotice] = useState('')

  const controller = useDeviceScreen({
    serial,
    customPath,
    options,
    autoStart: true,
  })
  const { connected, busy, dimensions, fps, state, stop, start } = controller

  // The webview is torn down on window close without unmounting React, so the
  // component's own cleanup never runs. Detach (or stop, when this window owns
  // the session) explicitly before letting the window go, otherwise the backend
  // keeps a subscriber — and possibly a whole scrcpy-server — alive.
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])
  useEffect(() => {
    if (!isTauri()) return
    let dispose: (() => void) | undefined
    let disposed = false
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault()
        await stopRef.current().catch(() => undefined)
        await win.destroy()
      })
      if (disposed) unlisten()
      else dispose = unlisten
    })()
    return () => {
      disposed = true
      dispose?.()
    }
  }, [])

  const toggleAlwaysOnTop = useCallback(async () => {
    if (!isTauri()) return
    const next = !alwaysOnTop
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow()
      .setAlwaysOnTop(next)
      .catch(() => undefined)
    setAlwaysOnTop(next)
  }, [alwaysOnTop])

  const handleScreenshot = useCallback(async () => {
    const result = await controller.screenshot(undefined, deviceName || serial)
    if (!result) return
    setNotice(result.success ? `Saved ${result.path}` : result.error || 'Screenshot failed')
  }, [controller, deviceName, serial])

  // Clear the transient screenshot/status line after a moment.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const statusLabel = connected
    ? `${dimensions ? `${dimensions.width} × ${dimensions.height}` : 'Live'} · ${fps} FPS`
    : busy
      ? 'Connecting…'
      : state === 'error'
        ? controller.error || 'Error'
        : 'Stopped'

  // The same rail the dashboard shows beside a device, so the controls do not
  // move when a device is popped out into its own window. It sits on the side
  // because the screen it frames is tall, not wide.
  const railGroups: RailGroup[] = [
    {
      label: 'Navigation',
      actions: [
        {
          id: 'back',
          label: 'Back',
          icon: ChevronLeft,
          onClick: () => controller.sendAction('back'),
          disabled: !connected,
        },
        {
          id: 'home',
          label: 'Home',
          icon: Home,
          onClick: () => controller.sendAction('home'),
          disabled: !connected,
        },
        {
          id: 'recents',
          label: 'Recents',
          icon: SquareStack,
          onClick: () => controller.sendAction('recent_apps'),
          disabled: !connected,
        },
        {
          id: 'rotate',
          label: 'Rotate',
          icon: RotateCw,
          onClick: () => controller.sendAction('rotate'),
          disabled: !connected,
        },
      ],
    },
    {
      label: 'Capture',
      actions: [
        {
          id: 'screenshot',
          label: 'Screenshot',
          icon: Camera,
          onClick: () => void handleScreenshot(),
          disabled: !connected,
        },
      ],
    },
    {
      label: 'Window and session',
      actions: [
        {
          id: 'always-on-top',
          label: alwaysOnTop ? 'Unpin from top' : 'Keep on top',
          icon: alwaysOnTop ? Pin : PinOff,
          onClick: () => void toggleAlwaysOnTop(),
          active: alwaysOnTop,
        },
        {
          id: 'session',
          label: connected ? 'Stop session' : 'Start session',
          icon: connected ? Square : Play,
          onClick: () => void (connected ? stop() : start()),
          disabled: busy,
          tone: connected ? ('danger' as const) : undefined,
        },
      ],
    },
  ]

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)]">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            connected
              ? 'bg-emerald-400'
              : busy
                ? 'bg-amber-400'
                : 'bg-[var(--text-subtle)]'
          }`}
        />
        <span className="truncate text-[10px] font-semibold text-[var(--text-base)]">
          {deviceName || serial}
        </span>
        <span className="ml-auto shrink-0 truncate text-[9px] tabular-nums text-[var(--text-subtle)]">
          {notice || statusLabel}
        </span>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <ActionRail
          ariaLabel="Device actions"
          groups={railGroups}
          expanded={railExpanded}
          onToggleExpanded={() => setRailExpanded((open) => !open)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 p-2">
          {controller.renderDisplay()}
        </div>
      </div>
    </div>
  )
}
