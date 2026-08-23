import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '../utils/tauriEnv'
import { useI18n } from '../i18n'
import { useSessionHistory } from './useSessionHistory'
import { applyQualityMode, type QualityMode } from '../utils/adaptiveQuality'
import { persistScrcpyLaunchConfig } from '../utils/scrcpyLaunch'
import { useDeviceRegistry } from './useDeviceRegistry'
import {
  discoveryRecordsFromResponse,
  onlineRecordsFromSerials,
} from '../types/deviceRegistry'
import {
  deviceTrackerRefreshInterval,
  isCurrentDeviceTrackerEvent,
  type AdbDeviceTrackerEvent,
} from '../types/deviceTracker'

export interface RenderDriverOption {
  id: string
  label: string
}

export interface RenderDriverSupport {
  hostOs: string
  supportsRenderDriver: boolean
  supportedDrivers: RenderDriverOption[]
}

export interface ScrcpyConfig {
  device: string
  sessionMode: string
  bitrate?: number
  fps?: number
  stayAwake?: boolean
  turnOff?: boolean
  audioEnabled?: boolean
  audioCodec?: string
  alwaysOnTop?: boolean
  fullscreen?: boolean
  borderless?: boolean
  record?: boolean
  recordPath?: string
  scrcpyPath?: string
  otgPure?: boolean
  cameraFacing?: string
  cameraId?: string
  codec?: string
  cameraAr?: string
  cameraHighSpeed?: boolean
  vdWidth?: number
  vdHeight?: number
  vdDpi?: number
  rotation?: string
  res?: string
  aspectRatioLock?: boolean
  hidKeyboard?: boolean
  hidMouse?: boolean
  renderDriver?: string
  // v4 features
  flexDisplay?: boolean
  cameraTorch?: boolean
  cameraZoom?: number
  backgroundColor?: string
  keepActive?: boolean
  vsync?: boolean
  // Window geometry, used by the Widget Layout canvas to place the mirror
  // window at a specific screen position/size.
  windowX?: number
  windowY?: number
  windowWidth?: number
  windowHeight?: number
  /** Applies a launch-time performance profile. Manual preserves explicit values. */
  qualityMode?: QualityMode
}

export const DEFAULT_SCRCPY_CONFIG: ScrcpyConfig = {
  device: '',
  sessionMode: 'mirror',
  bitrate: 8,
  fps: undefined,
  stayAwake: false,
  turnOff: false,
  audioEnabled: true,
  audioCodec: 'auto',
  alwaysOnTop: false,
  res: '0',
  recordPath: '',
  vdWidth: 1920,
  vdHeight: 1080,
  vdDpi: 420,
  aspectRatioLock: true,
  hidKeyboard: false,
  hidMouse: false,
  flexDisplay: false,
  cameraTorch: false,
  cameraZoom: 1.0,
  backgroundColor: '',
  keepActive: false,
  vsync: true,
  qualityMode: 'manual',
}

export function useScrcpy() {
  const { t } = useI18n()
  const [devices, setDevices] = useState<string[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [activeDevice, setActiveDevice] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [scrcpyStatus, setScrcpyStatus] = useState<{
    found: boolean
    message: string
  }>({ found: false, message: t('common.loading') })
  const [isAutoConnect, setIsAutoConnect] = useState<boolean>(true)
  const [isInitialized, setIsInitialized] = useState(false)
  const [runningDevices, setRunningDevices] = useState<string[]>([])
  const [defaultRecordPath, setDefaultRecordPath] = useState<string>('')
  const [detectedCameras, setDetectedCameras] = useState<
    { id: string; name: string }[]
  >([])
  const [renderDriverSupport, setRenderDriverSupport] =
    useState<RenderDriverSupport>({
      hostOs: 'unknown',
      supportsRenderDriver: false,
      supportedDrivers: [],
    })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false)
  // Removed mdnsDevices state
  const [theme, setTheme] = useState('ultraviolet')
  const [colorMode, setColorModeState] = useState<'light' | 'dark' | 'system'>(
    () => {
      try {
        return (
          (localStorage.getItem('scrcpy_color_mode') as
            | 'light'
            | 'dark'
            | 'system') || 'system'
        )
      } catch {
        return 'system'
      }
    },
  )
  const [config, setConfig] = useState<ScrcpyConfig>({
    ...DEFAULT_SCRCPY_CONFIG,
  })
  const {
    registry: deviceRegistry,
    registeredDevices,
    applyDiscovery,
    refreshHealth: refreshDeviceHealth,
  } = useDeviceRegistry({ customPath: config.scrcpyPath })
  const prevDevicesRef = useRef<string[]>([])
  const refreshDevicesRef = useRef<
    (customPath?: string, silent?: boolean, force?: boolean) => Promise<void>
  >(async () => undefined)
  const pendingSessionConfigsRef = useRef<Record<string, ScrcpyConfig>>({})
  const latestConfigRef = useRef(config)
  latestConfigRef.current = config
  const sessionHistory = useSessionHistory()

  useEffect(() => {
    const savedAuto = localStorage.getItem('scrcpy_auto_connect')
    if (savedAuto !== null) {
      setIsAutoConnect(savedAuto === 'true')
    }

    const savedTheme = localStorage.getItem('scrcpy_theme')
    if (savedTheme) {
      setTheme(savedTheme)
    }

    const savedConfig = localStorage.getItem('scrcpy_config')
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig)
        // Ensure audio is enabled by default even for older saved configs
        if (parsed.audioEnabled === undefined || parsed.audioEnabled === null) {
          parsed.audioEnabled = true
        }
        if (!parsed.audioCodec) {
          parsed.audioCodec = 'auto'
        }
        setConfig((prev) => ({ ...prev, ...parsed }))
        // Initial check with saved path if it exists
        if (parsed.scrcpyPath) {
          checkScrcpy(parsed.scrcpyPath)
        }
      } catch (e) {
        console.error('Failed to parse saved config', e)
      }
    }

    const initPaths = async () => {
      try {
        const defaultDir: string = await invoke('get_videos_dir')
        setDefaultRecordPath(defaultDir)

        // If no saved path in config, set it now
        setConfig((prev) => {
          if (!prev.recordPath) {
            return { ...prev, recordPath: defaultDir }
          }
          return prev
        })

        return defaultDir
      } catch (e) {
        console.error('Failed to fetch videos dir', e)
        return ''
      }
    }

    const initStart = async () => {
      if (isTauri()) {
        await initPaths()
      }
      setIsInitialized(true)
    }

    initStart()
  }, [])

  // Persist changes
  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem('scrcpy_config', JSON.stringify(config))
  }, [config, isInitialized])

  useEffect(() => {
    if (!isInitialized) return
    localStorage.setItem('scrcpy_theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme, isInitialized])

  useEffect(() => {
    const applyMode = (dark: boolean) => {
      document.documentElement.setAttribute(
        'data-mode',
        dark ? 'dark' : 'light',
      )
    }
    if (colorMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyMode(mq.matches)
      const handler = (e: MediaQueryListEvent) => applyMode(e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      applyMode(colorMode === 'dark')
    }
  }, [colorMode])

  const setColorMode = (mode: 'light' | 'dark' | 'system') => {
    setColorModeState(mode)
    localStorage.setItem('scrcpy_color_mode', mode)
  }

  // Clear detected cameras when device changes
  useEffect(() => {
    setDetectedCameras([])
  }, [activeDevice])

  const toggleAutoConnect = (val: boolean) => {
    setIsAutoConnect(val)
    localStorage.setItem('scrcpy_auto_connect', val.toString())
  }

  useEffect(() => {
    // Event listeners rely on Tauri IPC; skip outside the Tauri webview.
    if (!isTauri()) return

    const unlistenLog = listen<string>('scrcpy-log', (event) => {
      const newLines = event.payload.split('\n')
      setLogs((prev) => [...prev.slice(-(100 - newLines.length)), ...newLines])
    })

    const unlistenStatus = listen<any>('scrcpy-status', (event) => {
      const data = event.payload
      if (data.device && typeof data.running === 'boolean') {
        setRunningDevices((prev) => {
          if (data.running) {
            return [...new Set([...prev, data.device])]
          } else {
            return prev.filter((d) => d !== data.device)
          }
        })
        if (data.running) {
          sessionHistory.startSession(
            data.device,
            pendingSessionConfigsRef.current[data.device] || {
              ...latestConfigRef.current,
              device: data.device,
            },
          )
        } else {
          sessionHistory.endSession(data.device)
          delete pendingSessionConfigsRef.current[data.device]
        }
      } else if (data.type === 'downloading') {
        setIsDownloading(true)
        setStatus(data.message)
      } else if (data.type === 'download-progress') {
        setDownloadProgress(data.percent)
      } else if (data.type === 'download-complete') {
        setIsDownloading(false)
        setStatus(t('logs.downloadComplete'))
        refreshDevices(data.message)
        checkScrcpy() // Re-check binary status
      }
    })

    return () => {
      unlistenLog.then((f) => f())
      unlistenStatus.then((f) => f())
    }
  }, [t, sessionHistory.startSession, sessionHistory.endSession])

  const [historyDevices, setHistoryDevices] = useState<string[]>([])

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('scrcpy_history')
    if (savedHistory) {
      try {
        setHistoryDevices(JSON.parse(savedHistory))
      } catch (e) {
        console.error('Failed to parse history', e)
      }
    }
  }, [])

  const addToHistory = (ip: string) => {
    if (!ip.includes(':')) return // Only add valid IP:Port combos
    setHistoryDevices((prev) => {
      const next = [ip, ...prev.filter((d) => d !== ip)].slice(0, 10) // Keep last 10 unique
      localStorage.setItem('scrcpy_history', JSON.stringify(next))
      return next
    })
  }

  const clearHistory = () => {
    setHistoryDevices([])
    localStorage.removeItem('scrcpy_history')
  }

  const refreshDevices = async (
    customPath?: string,
    silent: boolean = false,
    force: boolean = false,
  ) => {
    if (isRefreshing && !force) return
    setIsRefreshing(true)
    try {
      const res: any = await invoke('get_devices', {
        customPath: customPath || config.scrcpyPath,
      })

      if (!res.error) {
        const newDevices = res.devices as string[]
        const structuredRecords = discoveryRecordsFromResponse(
          res.deviceRecords,
        )
        const discovery = applyDiscovery(
          structuredRecords.length > 0
            ? structuredRecords
            : onlineRecordsFromSerials(newDevices),
        )
        const diagnostics = Array.isArray(res.diagnostics)
          ? (res.diagnostics as string[])
          : []
        const prevDevices = prevDevicesRef.current
        const pendingDiscoveryMessage = t('logs.discoveryPending')

        diagnostics.forEach((diagnostic) => {
          setLogs((prev) => {
            const message = `[ADB] ${diagnostic}`
            return prev.includes(message)
              ? prev
              : [...prev.slice(-100), message]
          })
        })

        setLogs((prev) =>
          prev.filter((line) => line !== pendingDiscoveryMessage),
        )

        // Identify connections/disconnections
        const added = newDevices.filter((d) => !prevDevices.includes(d))
        const removed = prevDevices.filter((d) => !newDevices.includes(d))

        if (discovery.addedOnline.length > 0) {
          void refreshDeviceHealth(discovery.addedOnline)
        }

        added.forEach((device) => {
          setLogs((prev) => [
            ...prev.slice(-100),
            t('logs.newDeviceDiscovered', { device }),
          ])
          window.dispatchEvent(
            new CustomEvent('mobile-device-studio:device-online', {
              detail: { serial: device },
            }),
          )
        })

        removed.forEach((device) => {
          setLogs((prev) => [
            ...prev.slice(-100),
            t('logs.deviceDisconnected', { device }),
          ])
        })

        setDevices(newDevices)
        prevDevicesRef.current = newDevices

        if (!silent && added.length === 0 && removed.length === 0) {
          setLogs((prev) => [
            ...prev.slice(-100),
            t('logs.discoveryActive', { count: newDevices.length }),
          ])
        }

        if (newDevices.length > 0 && !activeDevice) {
          setActiveDevice(newDevices[0])
        }
      } else {
        const error =
          typeof res.error === 'string' &&
          res.error.trim() &&
          res.error !== 'true'
            ? t('logs.discoveryError', { error: res.error })
            : t('logs.discoveryPending')
        setLogs((prev) => [
          ...prev.filter((line) => line !== error).slice(-100),
          error,
        ])
      }
    } catch (e) {
      console.error(e)
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.errorRefreshingDevices', { error: String(e) }),
      ])
    } finally {
      setIsRefreshing(false)
    }
  }

  refreshDevicesRef.current = refreshDevices

  // Prefer ADB's long-running native tracker. A low-frequency safety refresh
  // guards against a missed event; if the tracker cannot start or exits, the
  // same timer automatically falls back to the previous 3-second cadence.
  useEffect(() => {
    if (!isTauri() || !isAutoConnect) return

    let disposed = false
    let trackerActive = false
    let trackerId: number | undefined
    let unlisten: (() => void) | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let lastRefreshAt = 0

    const refresh = () => {
      if (disposed) return
      lastRefreshAt = Date.now()
      void refreshDevicesRef.current(config.scrcpyPath || undefined, true, true)
    }
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refresh, 100)
    }

    const setup = async () => {
      try {
        unlisten = await listen<AdbDeviceTrackerEvent>(
          'adb-device-tracker',
          (event) => {
            if (!isCurrentDeviceTrackerEvent(event.payload, trackerId)) return
            if (event.payload.state === 'changed') {
              trackerActive = true
              scheduleRefresh()
            } else if (event.payload.state === 'stopped') {
              trackerActive = false
              scheduleRefresh()
            } else if (event.payload.message) {
              const message = `[ADB tracker] ${event.payload.message}`
              setLogs((previous) =>
                previous.includes(message)
                  ? previous
                  : [...previous.slice(-100), message],
              )
            }
          },
        )
        if (disposed) {
          unlisten()
          return
        }

        const result = await invoke<{
          success: boolean
          trackerId?: number
        }>('start_device_tracker', {
          customPath: config.scrcpyPath || undefined,
        })
        if (result.success && typeof result.trackerId === 'number') {
          trackerId = result.trackerId
          trackerActive = true
        }
        if (disposed && trackerId !== undefined) {
          void invoke('stop_device_tracker', { trackerId })
          return
        }
        refresh()
      } catch {
        trackerActive = false
        refresh()
      }
    }

    void setup()
    const fallbackTimer = window.setInterval(() => {
      const intervalMs = deviceTrackerRefreshInterval(trackerActive)
      if (Date.now() - lastRefreshAt >= intervalMs) refresh()
    }, 1_000)

    return () => {
      disposed = true
      window.clearInterval(fallbackTimer)
      if (refreshTimer) clearTimeout(refreshTimer)
      unlisten?.()
      if (trackerId !== undefined) {
        void invoke('stop_device_tracker', { trackerId })
      }
    }
  }, [isAutoConnect, config.scrcpyPath])

  const runScrcpy = async (launchConfig: ScrcpyConfig) => {
    const resolvedConfig = applyQualityMode(launchConfig)
    if (
      resolvedConfig.device === activeDevice &&
      resolvedConfig !== launchConfig
    ) {
      setConfig((previous) => ({
        ...previous,
        bitrate: resolvedConfig.bitrate,
        fps: resolvedConfig.fps,
        res: resolvedConfig.res,
      }))
    }
    persistScrcpyLaunchConfig(localStorage, resolvedConfig)
    pendingSessionConfigsRef.current[resolvedConfig.device] = resolvedConfig
    try {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.initializingScrcpy', { device: resolvedConfig.device }),
      ])
      await invoke('run_scrcpy', { config: resolvedConfig })
    } catch (e: any) {
      delete pendingSessionConfigsRef.current[resolvedConfig.device]
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.failedToStartScrcpy', { error: String(e) }),
      ])
    }
  }

  const stopScrcpy = async (device: string) => {
    try {
      await invoke('stop_scrcpy', { device })
    } catch (e) {
      console.error(e)
    }
  }

  const downloadScrcpy = async () => {
    try {
      setIsDownloading(true)
      await invoke('download_scrcpy')
    } catch (e: any) {
      setIsDownloading(false)
      setLogs((prev) => [
        ...prev,
        t('logs.downloadError', { error: String(e) }),
      ])
    }
  }

  const checkScrcpy = async (customPath?: string) => {
    try {
      // If customPath is explicitly provided (even as undefined/null for reset), use it.
      // Otherwise, use the saved path from config.
      const pathToCheck =
        customPath !== undefined ? customPath : config.scrcpyPath
      const res: any = await invoke('check_scrcpy', { customPath: pathToCheck })
      setScrcpyStatus(res)

      // Warn (once, on detection) when the installed scrcpy is newer than the
      // version this app was tested against. The backend auto-recovers from
      // unrecognised flags, so this is informational rather than blocking.
      if (res.found && res.untested && res.version) {
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.scrcpyVersionUntested', {
            version: res.version,
            tested: res.testedVersion,
          }),
        ])
      }

      if (res.found) {
        try {
          const renderRes: any = await invoke('get_render_drivers', {
            customPath: pathToCheck,
          })
          setRenderDriverSupport({
            hostOs: renderRes?.hostOs || 'unknown',
            supportsRenderDriver: !!renderRes?.supportsRenderDriver,
            supportedDrivers: Array.isArray(renderRes?.supportedDrivers)
              ? renderRes.supportedDrivers
              : [],
          })
        } catch {
          setRenderDriverSupport({
            hostOs: 'unknown',
            supportsRenderDriver: false,
            supportedDrivers: [],
          })
        }
      } else {
        setRenderDriverSupport({
          hostOs: 'unknown',
          supportsRenderDriver: false,
          supportedDrivers: [],
        })
      }

      // Auto-trigger onboarding if not found
      if (!res.found) {
        setIsOnboardingOpen(true)
      }

      return res.found
    } catch (e: any) {
      setScrcpyStatus({
        found: false,
        message: t('logs.genericError', { error: String(e) }),
      })
      return false
    }
  }

  const pairDevice = async (ip: string, code: string, customPath?: string) => {
    try {
      const res: any = await invoke('adb_pair', {
        ip,
        code,
        customPath: customPath || config.scrcpyPath,
      })
      if (res.success) {
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.successfullyPaired', { ip }),
        ])
        await refreshDevices(customPath, true)
      } else {
        setLogs((prev) => {
          const msgs = [
            t('logs.pairingFailed', { message: String(res.message) }),
          ]
          if (
            typeof res.message === 'string' &&
            res.message.includes('protocol fault')
          ) {
            msgs.push(t('logs.pairingProtocolFault'))
          }
          return [...prev.slice(-100), ...msgs]
        })
      }
      return res
    } catch (e: any) {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.pairingError', { error: String(e) }),
      ])
      return { success: false, message: e }
    }
  }

  // Android 11+ Wireless Debugging assigns a RANDOM connection port that is
  // different from the pairing port (and is not 5555). After a successful
  // pairing we therefore cannot assume any fixed port. This helper polls
  // `adb mdns services` to discover the actual `_adb-tls-connect` endpoint
  // advertised by the device for the given IP.
  const discoverConnectAddress = async (
    ip: string,
    customPath?: string,
  ): Promise<string | null> => {
    const path = customPath || config.scrcpyPath
    const targetIp = ip.split(':')[0]
    setLogs((prev) => [...prev.slice(-100), t('logs.discoveringPort')])

    // mDNS records can take a moment to appear after pairing, so retry a few times.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res: any = await invoke('get_mdns_devices', { customPath: path })
        if (res && !res.error && Array.isArray(res.services)) {
          const match = res.services.find(
            (s: any) =>
              typeof s.service === 'string' &&
              s.service.includes('adb-tls-connect') &&
              typeof s.address === 'string' &&
              s.address.startsWith(`${targetIp}:`),
          )
          if (match?.address) {
            setLogs((prev) => [
              ...prev.slice(-100),
              t('logs.discoveredPort', { ip: match.address }),
            ])
            return match.address as string
          }
        }
      } catch (e) {
        console.error('mDNS discovery failed', e)
      }
      await new Promise((r) => setTimeout(r, 800))
    }

    setLogs((prev) => [...prev.slice(-100), t('logs.portDiscoveryFailed')])
    return null
  }

  const connectDevice = async (ip: string, customPath?: string) => {
    setIsRefreshing(true)
    try {
      // Attempt 1: Connect
      let res: any = await invoke('adb_connect', {
        ip,
        customPath: customPath || config.scrcpyPath,
      })

      // Retry Logic: If failed, try to disconnect first then reconnect
      if (
        !res.success &&
        typeof res.message === 'string' &&
        (res.message.includes('failed to connect') ||
          res.message.includes('cannot connect'))
      ) {
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.connectionFailedRetrying'),
        ])
        // Force disconnect to clear ghost state
        await invoke('run_terminal_command', {
          cmd: `adb disconnect ${ip}`,
          customPath: customPath || config.scrcpyPath,
        })
        // Small delay
        await new Promise((r) => setTimeout(r, 500))
        // Attempt 2
        res = await invoke('adb_connect', {
          ip,
          customPath: customPath || config.scrcpyPath,
        })
      }

      if (res.success) {
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.connectedSuccessfully', { ip }),
        ])
        addToHistory(ip)

        // Allow ADB to settle and state to update
        await new Promise((r) => setTimeout(r, 1000))

        setIsRefreshing(false) // Enable refreshDevices to run
        await refreshDevices(customPath || config.scrcpyPath, true, true)
      } else {
        setLogs((prev) => {
          const msgs = [
            t('logs.connectionFailed', { message: String(res.message) }),
          ]
          // Smart tip for stale ports
          if (
            typeof res.message === 'string' &&
            (res.message.includes('failed to connect') ||
              res.message.includes('cannot connect'))
          ) {
            msgs.push(t('logs.connectionStaleTip'))
          }
          return [...prev.slice(-100), ...msgs]
        })
      }
      return res
    } catch (e: any) {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.connectionError', { error: String(e) }),
      ])
      return { success: false, message: e }
    } finally {
      setIsRefreshing(false)
    }
  }

  const listScrcpyOptions = async (
    device: string,
    arg: string,
    customPath?: string,
  ) => {
    try {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.runningScrcpyArg', { arg }),
      ])
      const res: any = await invoke('list_scrcpy_options', {
        device,
        arg,
        customPath: customPath || config.scrcpyPath,
      })
      if (res.output) {
        const lines = res.output.split('\n')
        setLogs((prev) => [...prev.slice(-100), ...lines])

        // Parse cameras if requested
        if (arg === '--list-cameras') {
          const cameras: { id: string; name: string }[] = []
          lines.forEach((line: string) => {
            const trimmedLine = line.trim()
            // New format (scrcpy 3.x): "    --camera-id=0    (back, 4080x3060, fps=[15, 20, 24, 30])"
            // Old format: "    - [0] (3264x2448) back, macro"
            const newMatch = trimmedLine.match(/--camera-id=(\w+)\s*\((.*?)\)/)
            const oldMatch = trimmedLine.match(
              /^(?:-\s*)?\[(\w+)\]\s*\((.*?)\)\s*(.*)/,
            )

            if (newMatch) {
              const id = newMatch[1]
              const details = newMatch[2] // e.g. "back, 4080x3060, fps=[...]"
              cameras.push({
                id,
                name: `${id}: ${details}`,
              })
            } else if (oldMatch) {
              const id = oldMatch[1]
              const resolution = oldMatch[2]
              const metadata = oldMatch[3].replace(/\r$/, '').trim()
              cameras.push({
                id,
                name: `${id}: ${metadata || 'Camera'} (${resolution})`,
              })
            }
          })
          if (cameras.length > 0) {
            setDetectedCameras(cameras)
          } else {
            setLogs((prev) => [...prev, t('logs.noCamerasParsed')])
          }
        }
      }
      return res
    } catch (e: any) {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.genericError', { error: String(e) }),
      ])
      return { success: false, message: e }
    }
  }

  const pushFile = async (
    device: string,
    filePath: string,
    customPath?: string,
  ) => {
    try {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.pushingFile', { device, filePath }),
      ])
      const res: any = await invoke('push_file', {
        device,
        filePath,
        customPath: customPath || config.scrcpyPath,
      })
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.adbPrefix', { message: String(res.message) }),
      ])
      return res
    } catch (e: any) {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.genericError', { error: String(e) }),
      ])
      return { success: false, message: e }
    }
  }

  const installApk = async (
    device: string,
    filePath: string,
    customPath?: string,
  ) => {
    try {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.installingApk', { device, filePath }),
      ])
      const res: any = await invoke('install_apk', {
        device,
        filePath,
        customPath: customPath || config.scrcpyPath,
      })
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.adbPrefix', { message: String(res.message) }),
      ])
      return res
    } catch (e: any) {
      setLogs((prev) => [
        ...prev.slice(-100),
        t('logs.genericError', { error: String(e) }),
      ])
      return { success: false, message: e }
    }
  }

  const runTerminalCommand = async (
    command: string,
    customPath?: string,
    logToSystem: boolean = true,
  ) => {
    try {
      // Check if user specifically typed scrcpy or adb to format log nicely
      const lower = command.trim().toLowerCase()
      const prefix =
        lower.startsWith('scrcpy') || lower.startsWith('adb') ? '' : 'adb '
      if (logToSystem) {
        setLogs((prev) => [...prev.slice(-100), `> ${prefix}${command}`])
      }

      const res: any = await invoke('run_terminal_command', {
        device: activeDevice,
        cmd: command,
        customPath: customPath || config.scrcpyPath,
      })

      if (logToSystem && res.stdout) {
        const lines = res.stdout.trim().split('\n')
        setLogs((prev) => [...prev.slice(-100), ...lines])
      }
      if (logToSystem && res.stderr) {
        const lines = res.stderr
          .trim()
          .split('\n')
          .map((l: string) => `[${res.binary?.toUpperCase() || 'ERR'}] ${l}`)
        setLogs((prev) => [...prev.slice(-100), ...lines])
      }
      return res
    } catch (e: any) {
      if (logToSystem) {
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.commandFailed', { error: String(e) }),
        ])
      }
      return { success: false, message: e }
    }
  }

  const clearLogs = () => setLogs([])

  return {
    devices,
    deviceRegistry,
    registeredDevices,
    refreshDeviceHealth,
    logs,
    setLogs,
    clearLogs,
    isDownloading,
    downloadProgress,
    status,
    refreshDevices,
    runScrcpy,
    stopScrcpy,
    downloadScrcpy,
    activeDevice,
    setActiveDevice,
    checkScrcpy,
    scrcpyStatus,
    pairDevice,
    connectDevice,
    discoverConnectAddress,
    listScrcpyOptions,
    runTerminalCommand,
    isAutoConnect,
    toggleAutoConnect,
    runningDevices,
    defaultRecordPath,
    detectedCameras,
    renderDriverSupport,
    isRefreshing,
    config,
    setConfig,
    theme,
    setTheme,
    colorMode,
    setColorMode,
    pushFile,
    installApk,
    historyDevices,
    clearHistory,
    sessionHistory,
    sessionRunning: runningDevices.includes(activeDevice || ''),
    isOnboardingOpen,
    setIsOnboardingOpen,
    completeOnboarding: () => {
      localStorage.setItem('scrcpy_onboarding_done', 'true')
      setIsOnboardingOpen(false)
    },
  }
}
