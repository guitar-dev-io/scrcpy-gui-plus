import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { Smartphone } from 'lucide-react'
import Sidebar from './components/Sidebar'
import ControlPanel from './components/ControlPanel'
import LogPanel from './components/LogPanel'
import Header from './components/Header'
import SessionBehavior from './components/SessionBehavior'
import ShortcutsPanel from './components/ShortcutsPanel'
import Footer from './components/Footer'
import AppNavigation from './components/app-shell/AppNavigation'
import AppShell from './components/app-shell/AppShell'
import DashboardLayout from './components/dashboard/DashboardLayout'
import IosWorkspaceStage from './components/dashboard/IosWorkspaceStage'
import WorkspaceTabBar from './components/workspace-tabs'
import WorkspaceToolSurface from './components/workspace-tabs/WorkspaceToolSurface'
import TestRunnerPanel from './components/test-runner'
import OnboardingModal from './components/OnboardingModal'
import ThemedModal from './components/ThemedModal'
import DeviceControlToolbar from './components/device-control-toolbar'
import ScreenshotManager from './components/screenshot-manager'
//import EmbeddedMirror from './components/embedded-mirror'
import MirrorStage from './components/mirror-stage'
import BugReportModal from './components/bug-report'
import AppManager from './components/app-manager'
import LogcatViewer from './components/logcat-viewer'
import CompactLogcatPanel from './components/logcat-viewer/CompactLogcatPanel'
import DeepLinkLauncher from './components/deep-link-launcher'
import TestSession from './components/test-session'
import UiInspector from './components/ui-inspector'
import DeviceStatus from './components/device-status'
import DeviceWorkspace from './components/device-workspace'
import EmbeddedDeviceWorkspace from './components/embedded-workspace'
import WirelessPairingWizard from './components/wireless-pairing-wizard'
import ConnectionHealth from './components/connection-health'
import PresetProfiles from './components/preset-profiles'
import MacroRecorder from './components/macro-recorder'
import CustomCommand from './components/custom-command'
import FileManager from './components/file-manager'
import WidgetLayout from './components/widget-layout'
import KeymapController from './components/keymap-controller'
import { DEFAULT_SCRCPY_CONFIG, useScrcpy } from './hooks/useScrcpy'
import { useScreenshot } from './hooks/useScreenshot'
import { useRecordingLibrary } from './hooks/useRecordingLibrary'
import { useDeviceStatus } from './hooks/useDeviceStatus'
import { useWorkspaceShell } from './hooks/useWorkspaceShell'
import { useEmbeddedMirror } from './hooks/useEmbeddedMirror'
import { useIosMirror, type IosDeviceInfo } from './hooks/useIosMirror'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from './utils/tauriEnv'
import { createBugReport } from './services/bugReportService'
import { applyQualityMode } from './utils/adaptiveQuality'
import { persistScrcpyLaunchConfig } from './utils/scrcpyLaunch'
import { openWorkspaceModal, type WorkspaceModal } from './types/workspaceModal'
import { useI18n } from './i18n'
import { ShellUiProvider, useShellUi } from './contexts/ShellUiContext'
import {
  DEVICE_PROFILES_KEY,
  DEVICE_CONFIG_PROFILES_KEY,
  getPreset,
  type DeviceConfigProfileMap,
  type DeviceProfileMap,
} from './types/presetProfiles'

const OtherPages = lazy(() => import('./components/pages/OtherPages'))
const DevicesPage = lazy(() => import('./components/pages/DevicesPage'))
const SessionsPage = lazy(() => import('./components/pages/SessionsPage'))
const ScreenshotsPage = lazy(() => import('./components/pages/ScreenshotsPage'))
const RecordingsPage = lazy(() => import('./components/pages/RecordingsPage'))
const SettingsPage = lazy(() => import('./components/pages/SettingsPage'))
const FileExplorerPage = lazy(() => import('./components/pages/FileExplorerPage'))
const WirelessAdbPage = lazy(() => import('./components/pages/WirelessAdbPage'))
const AppManagerPage = lazy(() => import('./components/pages/AppManagerPage'))
const LogcatViewerPage = lazy(() => import('./components/pages/LogcatViewerPage'))
const PerformancePage = lazy(() => import('./components/pages/PerformancePage'))
const InputControlPage = lazy(() => import('./components/pages/InputControlPage'))
const AutomationPage = lazy(() => import('./components/pages/AutomationPage'))
const ScriptManagerPage = lazy(() => import('./components/pages/ScriptManagerPage'))
const TaskSchedulerPage = lazy(() => import('./components/pages/TaskSchedulerPage'))

function AppContent() {
  const { t } = useI18n()
  const {
    activeRoute,
    navigate: handleNavigate,
    dashboardBottomTab,
    activeWorkspaceTool,
    selectWorkspaceTool,
    activateDeviceWorkspace,
  } = useShellUi()
  const {
    devices,
    logs,
    activeDevice,
    setActiveDevice,
    refreshDevices,
    runScrcpy,
    stopScrcpy,
    downloadScrcpy,
    checkScrcpy,
    scrcpyStatus,
    setLogs,
    isDownloading,
    downloadProgress,
    pairDevice,
    connectDevice,
    discoverConnectAddress,
    listScrcpyOptions,
    runTerminalCommand,
    isAutoConnect,
    toggleAutoConnect,
    runningDevices,
    isRefreshing,
    sessionRunning,
    clearLogs,
    detectedCameras,
    renderDriverSupport,
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
    isOnboardingOpen,
    setIsOnboardingOpen,
    completeOnboarding,
  } = useScrcpy()
  const { status: workspaceDeviceStatus } = useDeviceStatus({
    activeDevice,
    customPath: config.scrcpyPath,
    autoRefresh: true,
    enabled: Boolean(activeDevice),
  })
  const workspaceShell = useWorkspaceShell(runTerminalCommand)
  const recordingLibrary = useRecordingLibrary()
  const appliedDeviceProfileRef = useRef('')
  const latestActiveDeviceRef = useRef(activeDevice)
  const adaptiveRestartTimerRef = useRef<number | null>(null)
  latestActiveDeviceRef.current = activeDevice

  useEffect(() => () => {
    if (adaptiveRestartTimerRef.current !== null) {
      window.clearTimeout(adaptiveRestartTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeDevice || appliedDeviceProfileRef.current === activeDevice) return
    appliedDeviceProfileRef.current = activeDevice
    try {
      const profiles = JSON.parse(
        localStorage.getItem(DEVICE_PROFILES_KEY) || '{}',
      ) as DeviceProfileMap
      const configProfiles = JSON.parse(
        localStorage.getItem(DEVICE_CONFIG_PROFILES_KEY) || '{}',
      ) as DeviceConfigProfileMap
      const preset = profiles[activeDevice] ? getPreset(profiles[activeDevice]) : undefined
      setConfig((previous) => ({
        ...DEFAULT_SCRCPY_CONFIG,
        scrcpyPath: previous.scrcpyPath,
        recordPath: previous.recordPath,
        ...(preset?.config || {}),
        ...(configProfiles[activeDevice] || {}),
        device: activeDevice,
      }))
    } catch {
      setConfig((previous) => ({ ...previous, device: activeDevice }))
    }
  }, [activeDevice, setConfig])

  const [alertState, setAlertState] = useState<{
    isOpen: boolean
    title: string
    message: string
    kind: 'warning' | 'error' | 'info' | 'success'
    actionLabel?: string
    onAction?: () => void
    showCancel?: boolean
    cancelLabel?: string
    onCancel?: () => void
  }>({
    isOpen: false,
    title: '',
    message: '',
    kind: 'info',
  })

  const [appVersion, setAppVersion] = useState('3.3.0')
  const [lastCheckedPath, setLastCheckedPath] = useState<string | undefined>(
    undefined,
  )
  const [hasCheckedUpdate, setHasCheckedUpdate] = useState(false)

  const showAlert = (
    title: string,
    message: string,
    kind: 'warning' | 'error' | 'info' | 'success' = 'info',
    actionLabel = 'OK',
    onAction?: () => void,
    showCancel = false,
    cancelLabel = 'Cancel',
    onCancel?: () => void,
  ) => {
    setAlertState({
      isOpen: true,
      title,
      message,
      kind,
      actionLabel,
      onAction,
      showCancel,
      cancelLabel,
      onCancel,
    })
  }

  // Lightweight notifier reused by the toolbar / screenshot / bug report UIs.
  const notify = (
    title: string,
    message: string,
    kind: 'success' | 'error' | 'info' | 'warning',
  ) => showAlert(title, message, kind)

  const screenshot = useScreenshot({
    activeDevice,
    customPath: config.scrcpyPath,
  })
  const [quickDiagnosticBusy, setQuickDiagnosticBusy] = useState(false)

  const handleQuickDiagnostic = async () => {
    if (!activeDevice || quickDiagnosticBusy) return
    const outputDir = screenshot.screenshotDir || config.recordPath || ''
    if (!outputDir) {
      notify('Diagnostic bundle', 'Choose an output directory first.', 'warning')
      return
    }
    if (!window.confirm('Create a diagnostic ZIP containing device information, screenshot, and unfiltered system logcat? Sensitive data may be included.')) return
    setQuickDiagnosticBusy(true)
    try {
      const result = await createBugReport({
        deviceSerial: activeDevice,
        title: `Quick diagnostic — ${activeDevice}`,
        description: 'Automatically collected diagnostic bundle.',
        steps: '',
        expected: '',
        actual: '',
        outputDir,
        includeCurrentScreenshot: false,
        includeNewScreenshot: true,
        includeLogcat: true,
        includeDeviceInfo: true,
        includeAppInfo: false,
        includeRecording: Boolean(
          recordingLibrary.history.find((entry) => entry.deviceSerial === activeDevice)?.path,
        ),
        recordingPath: recordingLibrary.history.find(
          (entry) => entry.deviceSerial === activeDevice,
        )?.path,
        customPath: config.scrcpyPath,
      })
      notify(
        result.success ? 'Diagnostic bundle ready' : 'Diagnostic bundle failed',
        result.success ? result.zipPath : result.error || 'Unknown error',
        result.success ? (result.warnings.length ? 'warning' : 'success') : 'error',
      )
    } catch (error) {
      notify('Diagnostic bundle failed', String(error), 'error')
    } finally {
      setQuickDiagnosticBusy(false)
    }
  }

  const embeddedMirror = useEmbeddedMirror()
  const [isMirrorStageOpen, setIsMirrorStageOpen] = useState(false)
  const [embeddedConnections, setEmbeddedConnections] = useState<Record<string, boolean>>({})
  const [openDeviceWorkspaces, setOpenDeviceWorkspaces] = useState<string[]>([])
  const [deviceWorkspaceLabels, setDeviceWorkspaceLabels] = useState<Record<string, string>>({})
  const [multiDeviceView, setMultiDeviceView] = useState(true)
  const [embeddedSessionCommands, setEmbeddedSessionCommands] = useState<Record<
    string,
    { id: number; action: 'start' | 'stop' }
  >>({})
  const embeddedDashboardConnected = Boolean(activeDevice && embeddedConnections[activeDevice])

  const requestEmbeddedSession = (action: 'start' | 'stop', serial = activeDevice) => {
    if (!serial) return
    setEmbeddedSessionCommands((current) => ({
      ...current,
      [serial]: { id: (current[serial]?.id ?? 0) + 1, action },
    }))
  }

  const openDeviceWorkspace = (serial: string) => {
    setOpenDeviceWorkspaces((current) => (
      current.includes(serial) ? current : [...current, serial]
    ))
    setActiveDevice(serial)
    setActiveIosUdid(null)
    activateDeviceWorkspace()
    handleNavigate('dashboard')
  }

  const closeDeviceWorkspace = (serial: string) => {
    if (embeddedConnections[serial]) requestEmbeddedSession('stop', serial)
    if (runningDevices.includes(serial)) void stopScrcpy(serial)
    setEmbeddedConnections((current) => ({ ...current, [serial]: false }))
    const remaining = Array.from(new Set([
      ...openDeviceWorkspaces,
      ...runningDevices,
    ])).filter((item) => item !== serial)
    setOpenDeviceWorkspaces((current) => current.filter((item) => item !== serial))
    if (serial === activeDevice) setActiveDevice(remaining[remaining.length - 1] ?? '')
  }

  useEffect(() => {
    const connected = Object.entries(embeddedConnections)
      .filter(([, value]) => value)
      .map(([serial]) => serial)
    if (connected.length === 0) return
    setOpenDeviceWorkspaces((current) => Array.from(new Set([...current, ...connected])))
  }, [embeddedConnections])

  useEffect(() => {
    if (
      !activeDevice
      || workspaceDeviceStatus?.serial !== activeDevice
      || !workspaceDeviceStatus.model
    ) return
    const model = workspaceDeviceStatus.model
    setDeviceWorkspaceLabels((current) => (
      current[activeDevice] === model
        ? current
        : { ...current, [activeDevice]: model }
    ))
  }, [activeDevice, workspaceDeviceStatus?.model, workspaceDeviceStatus?.serial])

  const ios = useIosMirror(config.scrcpyPath)
  const [openIosWorkspaces, setOpenIosWorkspaces] = useState<string[]>([])
  const [iosWorkspaceDevices, setIosWorkspaceDevices] = useState<Record<string, IosDeviceInfo>>({})
  const [activeIosUdid, setActiveIosUdid] = useState<string | null>(null)
  const [iosStreaming, setIosStreaming] = useState<Record<string, boolean>>({})
  const activeAndroidWorkspaceDevice = activeIosUdid ? '' : activeDevice

  const openIosWorkspace = (device: IosDeviceInfo) => {
    setOpenIosWorkspaces((current) => (
      current.includes(device.udid) ? current : [...current, device.udid]
    ))
    setIosWorkspaceDevices((current) => ({ ...current, [device.udid]: device }))
    setActiveIosUdid(device.udid)
    activateDeviceWorkspace()
    handleNavigate('dashboard')
  }

  const closeIosWorkspace = (udid: string) => {
    setOpenIosWorkspaces((current) => current.filter((item) => item !== udid))
    setIosStreaming((current) => ({ ...current, [udid]: false }))
    setIosWorkspaceDevices((current) => {
      const next = { ...current }
      delete next[udid]
      return next
    })
    if (activeIosUdid !== udid) return
    const remaining = openIosWorkspaces.filter((item) => item !== udid)
    setActiveIosUdid(remaining[remaining.length - 1] ?? null)
  }

  // Detect iOS mirroring support (macOS + pymobiledevice3) and scan once on mount.
  useEffect(() => {
    if (!isTauri()) return
    ;(async () => {
      const support = await ios.checkSupport()
      if (support?.supported && support.found) {
        ios.refreshDevices()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [isBugReportOpen, setIsBugReportOpen] = useState(false)
  const [isAppManagerOpen, setIsAppManagerOpen] = useState(false)
  const [isLogcatOpen, setIsLogcatOpen] = useState(false)
  const [isDeepLinkOpen, setIsDeepLinkOpen] = useState(false)
  const [isTestSessionOpen, setIsTestSessionOpen] = useState(false)
  const [isUiInspectorOpen, setIsUiInspectorOpen] = useState(false)
  const [isDeviceStatusOpen, setIsDeviceStatusOpen] = useState(false)
  const [workspaceModal, setWorkspaceModal] = useState<WorkspaceModal>(null)
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const [isConnHealthOpen, setIsConnHealthOpen] = useState(false)
  const [isPresetsOpen, setIsPresetsOpen] = useState(false)
  const [isMacroOpen, setIsMacroOpen] = useState(false)
  const [isCustomCmdOpen, setIsCustomCmdOpen] = useState(false)
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false)
  const [isWidgetLayoutOpen, setIsWidgetLayoutOpen] = useState(false)
  const [isKeymapOpen, setIsKeymapOpen] = useState(false)

  // Confirmation helper for destructive actions (clear data, uninstall, ...).
  const confirmAction = (
    title: string,
    message: string,
    onConfirm: () => void,
  ) => {
    showAlert(
      title,
      message,
      'warning',
      t('common.confirm'),
      onConfirm,
      true,
      t('common.cancel'),
    )
  }

  // Browse for an APK and install it on the active device.
  const handleInstallApkBrowse = async () => {
    if (!activeDevice) {
      showAlert(
        t('alerts.noDeviceSelectedTitle'),
        t('alerts.noDeviceSelectedMessage'),
        'warning',
      )
      return
    }
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Android App (APK)', extensions: ['apk'] }],
      })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      for (const path of paths) {
        await installApk(activeDevice, path)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleScreenshotCapture = async (serial?: string) => {
    const target = serial || activeDevice
    if (!target) {
      showAlert(
        t('alerts.noDeviceSelectedTitle'),
        t('alerts.noDeviceSelectedMessage'),
        'warning',
      )
      return
    }
    const res = await screenshot.capture(target)
    if (res.success) {
      notify(
        t('screenshot.captureSuccessTitle'),
        t('screenshot.captureSuccessMessage', { path: res.path }),
        'success',
      )
    } else if (res.errorCode !== 'busy') {
      const localizedKey = res.errorCode
        ? `screenshot.errors.${res.errorCode}`
        : ''
      const localized = localizedKey ? t(localizedKey) : ''
      const message =
        localized && localized !== localizedKey
          ? localized
          : res.error || 'Unknown error'
      notify(t('screenshot.captureFailedTitle'), message, 'error')
    }
  }

  const handleChangeScreenshotDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: screenshot.screenshotDir || undefined,
      })
      if (selected && typeof selected === 'string') {
        screenshot.setScreenshotDir(selected)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleChangeRecordPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: config.recordPath || undefined,
      })
      if (selected && typeof selected === 'string') {
        setConfig((prev) => ({ ...prev, recordPath: selected }))
        localStorage.setItem('scrcpy_record_path', selected)
      }
    } catch (error) {
      console.error(error)
    }
  }

  const handleScreenshotAction = async (
    fn: (path: string) => Promise<void>,
    path: string,
  ) => {
    try {
      await fn(path)
    } catch (e) {
      notify(t('screenshot.actionFailedTitle'), String(e), 'error')
    }
  }

  // Global screenshot shortcut: Ctrl+Shift+S (Win/Linux) / Cmd+Shift+S (macOS).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 's' || e.key === 'S')
      ) {
        e.preventDefault()
        if (activeDevice && !screenshot.isCapturing) {
          handleScreenshotCapture()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice, screenshot.isCapturing])

  useEffect(() => {
    // Initial setup: fetch version and close splashscreen
    const initApp = async () => {
      try {
        const v = await getVersion()
        setAppVersion(v)

        await invoke('close_splashscreen')
      } catch (e) {
        console.error('Initialization failed:', e)
      }
    }

    const timer = setTimeout(initApp, 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    // Initial check (once on mount) - Silent to avoid log clatter
    checkScrcpy(config.scrcpyPath)
    refreshDevices(config.scrcpyPath, true)
  }, [])

  useEffect(() => {
    if (
      scrcpyStatus.found &&
      (!hasCheckedUpdate || config.scrcpyPath !== lastCheckedPath) &&
      !isDownloading
    ) {
      setHasCheckedUpdate(true)
      setLastCheckedPath(config.scrcpyPath)

      const runCheck = async () => {
        try {
          const updateRes: any = await invoke('check_scrcpy_update', {
            customPath: config.scrcpyPath,
          })
          if (updateRes && updateRes.update_available) {
            showAlert(
              t('alerts.updateAvailableTitle'),
              t('alerts.updateAvailableMessage', {
                local: updateRes.local_version || 'unknown',
                latest: updateRes.latest_version || 'unknown',
              }),
              'info',
              t('alerts.updateBtn'),
              async () => {
                if (config.scrcpyPath) {
                  setConfig((prev) => ({ ...prev, scrcpyPath: undefined }))
                }
                await downloadScrcpy()
              },
              true,
              t('alerts.cancelBtn'),
            )
          }
        } catch (e) {
          console.error('Failed to check for scrcpy updates:', e)
        }
      }
      runCheck()
    } else if (!scrcpyStatus.found) {
      setHasCheckedUpdate(false)
    }
  }, [
    scrcpyStatus.found,
    config.scrcpyPath,
    isDownloading,
    hasCheckedUpdate,
    lastCheckedPath,
    t,
  ])

  useEffect(() => {
    // Global Drag and Drop Listener (re-bind only if activeDevice changes).
    // Skip when running outside the Tauri webview (e.g. plain browser dev),
    // where the window IPC internals are unavailable.
    if (!isTauri()) return

    const unlisten = getCurrentWindow().listen<{ paths: string[] }>(
      'tauri://drag-drop',
      (event) => {
        if (!activeDevice) {
          setLogs((prev) => [
            ...prev.slice(-100),
            t('logs.noDeviceForDragDrop'),
          ])
          return
        }

        const paths = event.payload.paths
        if (paths && paths.length > 0) {
          paths.forEach((path) => handleFileOperation(path))
        }
      },
    )

    return () => {
      unlisten.then((f) => f())
    }
  }, [activeDevice])

  useEffect(() => {
    if (activeDevice) {
      setConfig((prev) => ({ ...prev, device: activeDevice }))
    }
  }, [activeDevice])

  const handleStart = async () => {
    if (!activeDevice) {
      showAlert(
        t('alerts.noDeviceSelectedTitle'),
        t('alerts.noDeviceSelectedMessage'),
        'warning',
      )
      return
    }
    let launchConfig = config
    if (embeddedMirror.embedEnabled) {
      // Open the dedicated full-window stage first, then wait for it to lay
      // out so we can measure it and dock scrcpy to fill it.
      setIsMirrorStageOpen(true)
      await new Promise((r) => setTimeout(r, 80))
      const dock = await embeddedMirror.computeDockConfig()
      if (dock) {
        launchConfig = { ...config, ...dock }
        setLogs((prev: string[]) => [
          ...prev.slice(-100),
          `[EMBED] docking mirror at x=${dock.windowX} y=${dock.windowY} w=${dock.windowWidth} h=${dock.windowHeight}`,
        ])
      } else {
        setLogs((prev: string[]) => [
          ...prev.slice(-100),
          '[EMBED] stage not ready; launching normally',
        ])
      }
    }
    await runScrcpy(launchConfig)
  }

  const handleCloseMirrorStage = async () => {
    setIsMirrorStageOpen(false)
    if (activeDevice) await stopScrcpy(activeDevice)
  }

  const handleStop = async () => {
    if (!activeDevice) return
    await stopScrcpy(activeDevice)
  }

  // Re-dock: the scrcpy window can't be moved after launch, so restart the
  // session so it re-positions over the (possibly moved) dock area.
  const handleRedock = async () => {
    if (!activeDevice) return
    await stopScrcpy(activeDevice)
    // Give scrcpy a moment to release before relaunching at the new geometry.
    setTimeout(() => {
      void handleStart()
    }, 600)
  }

  const handleRefresh = () => {
    refreshDevices()
  }

  const handleKillAdb = async () => {
    try {
      await invoke('kill_adb', { customPath: config.scrcpyPath })
      refreshDevices(config.scrcpyPath)
    } catch (e) {
      console.error(e)
    }
  }

  const handleFileOperation = async (path: string) => {
    if (!activeDevice) return

    const isApk = path.toLowerCase().endsWith('.apk')
    if (isApk) {
      await installApk(activeDevice, path)
    } else {
      await pushFile(activeDevice, path)
    }
  }

  const handleFileBrowse = async () => {
    if (!activeDevice) return
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'All Files',
            extensions: ['*'],
          },
          {
            name: 'Android App (APK)',
            extensions: ['apk'],
          },
        ],
      })

      if (selected) {
        if (Array.isArray(selected)) {
          selected.forEach((path) => handleFileOperation(path))
        } else {
          handleFileOperation(selected)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSetPath = async () => {
    try {
      let startPath = config.scrcpyPath
      if (!startPath) {
        startPath = await invoke<string>('get_scrcpy_bin_dir').catch(() => '')
      }
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: startPath || undefined,
      })
      if (selected && typeof selected === 'string') {
        setConfig((prev) => ({ ...prev, scrcpyPath: selected }))
        setLogs((prev) => [
          ...prev.slice(-100),
          t('logs.customScrcpyPathSet', { path: selected }),
        ])
        // Trigger a check with the new path
        setTimeout(() => checkScrcpy(selected), 100)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleResetPath = async () => {
    setConfig((prev) => ({ ...prev, scrcpyPath: undefined }))
    setLogs((prev) => [...prev.slice(-100), t('logs.customScrcpyPathCleared')])
    // Trigger a check with no custom path
    setTimeout(() => checkScrcpy(undefined), 100)
  }

  const deviceSidebar = (
    <Sidebar
      devices={devices}
      runningDevices={runningDevices}
      onRefresh={handleRefresh}
      onKillAdb={handleKillAdb}
      selectedDevice={activeDevice}
      onSelectDevice={setActiveDevice}
      onPair={pairDevice}
      onConnect={connectDevice}
      onDiscoverConnect={discoverConnectAddress}
      isAutoConnect={isAutoConnect}
      onToggleAuto={toggleAutoConnect}
      isRefreshing={isRefreshing}
      onFilePush={handleFileBrowse}
      onOpenWorkspace={() => setWorkspaceModal((current) => openWorkspaceModal(current, 'batch'))}
      onOpenPairing={() => setIsPairingOpen(true)}
      historyDevices={historyDevices}
      clearHistory={clearHistory}
      iosSupported={ios.support.supported}
      iosFound={ios.support.found}
      iosMessage={ios.support.message}
      iosDevices={ios.devices}
      iosRefreshing={ios.isRefreshing}
      iosInstalling={ios.isInstalling}
      onIosRefresh={ios.refreshDevices}
      onIosInstall={async () => {
        const res = await ios.installTool()
        notify(
          'iOS Tools',
          res.success
            ? 'pymobiledevice3 installed successfully.'
            : res.message,
          res.success ? 'success' : 'error',
        )
      }}
      onIosMirror={openIosWorkspace}
    />
  )

  const deviceToolbar = (
    <DeviceControlToolbar
      compact
      activeDevice={activeDevice}
      customPath={config.scrcpyPath}
      isRunning={sessionRunning || embeddedDashboardConnected}
      recordingOutputDir={screenshot.screenshotDir}
      fullscreenActive={!!config.fullscreen}
      onToggleFullscreen={() =>
        setConfig((prev) => ({
          ...prev,
          fullscreen: !prev.fullscreen,
        }))
      }
      onScreenshot={() => handleScreenshotCapture()}
      isCapturing={screenshot.isCapturing}
      onOpenBugReport={() => setIsBugReportOpen(true)}
      onQuickDiagnostic={() => void handleQuickDiagnostic()}
      quickDiagnosticBusy={quickDiagnosticBusy}
      onOpenAppManager={() => setIsAppManagerOpen(true)}
      onOpenLogcat={() => setIsLogcatOpen(true)}
      onOpenDeepLink={() => setIsDeepLinkOpen(true)}
      onOpenTestSession={() => setIsTestSessionOpen(true)}
      onOpenUiInspector={() => setIsUiInspectorOpen(true)}
      onOpenDeviceStatus={() => setIsDeviceStatusOpen(true)}
      onOpenConnectionHealth={() => setIsConnHealthOpen(true)}
      onOpenPresets={() => setIsPresetsOpen(true)}
      onOpenMacro={() => setIsMacroOpen(true)}
      onOpenCustomCommand={() => setIsCustomCmdOpen(true)}
      onOpenFileManager={() => setIsFileManagerOpen(true)}
      onOpenWidgetLayout={() => setIsWidgetLayoutOpen(true)}
      onOpenKeymap={() => setIsKeymapOpen(true)}
      onOpenEmbeddedWorkspace={() => setWorkspaceModal((current) => openWorkspaceModal(current, 'embedded'))}
      notify={notify}
    />
  )

  const controlPanel = (
    <ControlPanel
      config={config}
      setConfig={setConfig}
      onStart={handleStart}
      onStop={handleStop}
      isRunning={sessionRunning}
      detectedCameras={detectedCameras}
      renderDriverSupport={renderDriverSupport}
      onListOptions={(arg) => {
        if (activeDevice) listScrcpyOptions(activeDevice, arg)
      }}
    />
  )

  const sessionBehavior = <SessionBehavior config={config} setConfig={setConfig} />

  const renderScreenshotManager = (dashboard = false) => (
    <ScreenshotManager
      dashboard={dashboard}
      history={screenshot.history}
      screenshotDir={screenshot.screenshotDir}
      isCapturing={screenshot.isCapturing}
      canCapture={!!activeDevice}
      shortcutLabel={
        navigator.platform.toLowerCase().includes('mac')
          ? 'Cmd+Shift+S'
          : 'Ctrl+Shift+S'
      }
      onCapture={() => handleScreenshotCapture()}
      onChangeDirectory={handleChangeScreenshotDir}
      onOpenImage={(path) =>
        handleScreenshotAction(screenshot.openImage, path)
      }
      onOpenFolder={(path) =>
        handleScreenshotAction(screenshot.openFolder, path)
      }
      onCopyImage={async (path) => {
        try {
          await screenshot.copyToClipboard(path)
          notify(
            t('screenshot.copiedTitle'),
            t('screenshot.copiedMessage'),
            'success',
          )
        } catch (error) {
          notify(t('screenshot.actionFailedTitle'), String(error), 'error')
        }
      }}
      onDeleteEntry={(id) => screenshot.deleteEntry(id)}
      onClearHistory={screenshot.clearHistory}
    />
  )

  const logPanel = (
    <LogPanel
      logs={logs}
      onClear={clearLogs}
      onAddLog={(message) =>
        setLogs((prev: string[]) => [...prev.slice(-100), message])
      }
      onRunCommand={runTerminalCommand}
    />
  )

  const renderDashboardLogPanel = (serial: string, enabled: boolean) => (
    dashboardBottomTab === 'logcat' ? (
      <CompactLogcatPanel
        activeDevice={serial}
        customPath={config.scrcpyPath}
        enabled={enabled && activeRoute === 'dashboard' && !activeWorkspaceTool}
      />
    ) : <LogPanel
      dashboard
      mode={dashboardBottomTab === 'test-runner' ? 'logcat' : dashboardBottomTab}
      logs={dashboardBottomTab === 'shell' ? workspaceShell.logs : logs}
      stableEntries={dashboardBottomTab === 'shell' ? workspaceShell.entries : undefined}
      onClear={dashboardBottomTab === 'shell' ? workspaceShell.clear : clearLogs}
      onAddLog={dashboardBottomTab === 'shell'
        ? workspaceShell.addLog
        : (message) => setLogs((prev: string[]) => [...prev.slice(-100), message])}
      onRunCommand={dashboardBottomTab === 'shell'
        ? workspaceShell.runCommand
        : runTerminalCommand}
    />
  )

  const embeddedRunningDevices = Object.entries(embeddedConnections)
    .filter(([, connected]) => connected)
    .map(([serial]) => serial)
  const dashboardWorkspaceSerials = Array.from(new Set([
    ...openDeviceWorkspaces,
    ...(activeDevice ? [activeDevice] : []),
  ]))
  const iosDevicesByUdid = new Map([
    ...Object.values(iosWorkspaceDevices),
    ...ios.devices,
  ].map((device) => [device.udid, device]))
  const dashboardWorkspaceIds = Array.from(new Set([
    ...dashboardWorkspaceSerials,
    ...openIosWorkspaces.filter((udid) => iosDevicesByUdid.has(udid)),
  ]))
  const activeWorkspaceDevice = activeIosUdid ?? activeDevice
  const iosRunningDevices = Object.entries(iosStreaming)
    .filter(([, streaming]) => streaming)
    .map(([udid]) => udid)
  const workspaceDeviceLabels = {
    ...deviceWorkspaceLabels,
    ...Object.fromEntries(Array.from(iosDevicesByUdid.values()).map((device) => [device.udid, device.name || device.productType])),
  }
  const workspaceDeviceKinds = Object.fromEntries([
    ...dashboardWorkspaceSerials.map((serial) => [serial, 'android'] as const),
    ...openIosWorkspaces.map((udid) => [udid, 'ios'] as const),
  ])

  const workspaceShellPanel = (
    <LogPanel
      dashboard
      mode="shell"
      logs={workspaceShell.logs}
      stableEntries={workspaceShell.entries}
      onClear={workspaceShell.clear}
      onAddLog={workspaceShell.addLog}
      onRunCommand={workspaceShell.runCommand}
    />
  )

  const iosToolUnavailable = (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
      <Smartphone size={24} className="text-[var(--text-subtle)]" />
      <p className="text-[11px] font-semibold text-[var(--text-muted)]">Unavailable for iOS view-only sessions</p>
      <p className="max-w-md text-[9px] leading-relaxed text-[var(--text-subtle)]">
        Logcat, shell, files and Android automation require ADB. Select an Android workspace to use this tool.
      </p>
    </div>
  )

  const appHeader = (compact = false) => (
    <Header
      compact={compact}
      onThemeChange={setTheme}
      currentTheme={theme}
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      binaryStatus={scrcpyStatus}
      activeDevice={activeAndroidWorkspaceDevice}
      customPath={config.scrcpyPath}
      connected={activeIosUdid ? false : sessionRunning}
      isRefreshing={isRefreshing}
      onRefresh={handleRefresh}
      onOpenSettings={() => handleNavigate('settings')}
      onDownload={downloadScrcpy}
      onSetPath={handleSetPath}
      onResetPath={handleResetPath}
      isDownloading={isDownloading}
      downloadProgress={downloadProgress}
      version={appVersion}
    />
  )

  return (
    <AppShell
      header={undefined}
      navigation={
        <AppNavigation
          actions={{
            'shell-terminal': () => {
              selectWorkspaceTool('shell')
            },
          }}
          activeDevice={activeAndroidWorkspaceDevice}
          customPath={config.scrcpyPath}
          sessionRunning={sessionRunning || embeddedDashboardConnected}
          onStopSession={() => {
            if (embeddedDashboardConnected) requestEmbeddedSession('stop')
            if (sessionRunning) void handleStop()
          }}
        />
      }
      footer={
        <Footer
          version={appVersion}
        />
      }
      content={
        <>
          <WorkspaceTabBar
            deviceWorkspaces={Array.from(new Set([
              ...openDeviceWorkspaces,
              ...runningDevices,
              ...embeddedRunningDevices,
              ...openIosWorkspaces,
            ]))}
            deviceLabels={workspaceDeviceLabels}
            deviceKinds={workspaceDeviceKinds}
            runningDevices={Array.from(new Set([
              ...runningDevices,
              ...embeddedRunningDevices,
              ...iosRunningDevices,
            ]))}
            activeDevice={activeWorkspaceDevice}
            onSelectDevice={(workspaceId) => {
              const iosDevice = iosDevicesByUdid.get(workspaceId)
              if (iosDevice) openIosWorkspace(iosDevice)
              else openDeviceWorkspace(workspaceId)
            }}
            onCloseDevice={(workspaceId) => {
              if (iosDevicesByUdid.has(workspaceId)) closeIosWorkspace(workspaceId)
              else closeDeviceWorkspace(workspaceId)
            }}
            onAddDevice={() => setIsPairingOpen(true)}
            multiDeviceView={multiDeviceView}
            onToggleMultiDeviceView={() => setMultiDeviceView((current) => !current)}
            toolbar={appHeader(true)}
          />
          <div
            aria-hidden={activeRoute !== 'dashboard' ? true : undefined}
            className={
              activeRoute !== 'dashboard' || (activeWorkspaceTool && activeWorkspaceTool !== 'file-explorer')
                ? 'hidden'
                : multiDeviceView && dashboardWorkspaceIds.length > 1
                  ? 'grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-2'
                  : 'contents'
            }
          >
            {(dashboardWorkspaceIds.length > 0 ? dashboardWorkspaceIds : ['']).map((workspaceId) => {
            const iosDevice = iosDevicesByUdid.get(workspaceId)
            const serial = workspaceId
            return (
            <div
              key={workspaceId || 'empty-device-workspace'}
              className={
                (!multiDeviceView || dashboardWorkspaceIds.length <= 1) && workspaceId !== activeWorkspaceDevice
                  ? 'hidden'
                  : multiDeviceView && dashboardWorkspaceIds.length > 1
                    ? 'min-h-[430px] min-w-0'
                    : 'contents'
              }
              aria-hidden={
                (!multiDeviceView || dashboardWorkspaceIds.length <= 1) && workspaceId !== activeWorkspaceDevice
                  ? true
                  : undefined
              }
            >
              {iosDevice ? (
                <IosWorkspaceStage
                  device={iosDevice}
                  customPath={config.scrcpyPath}
                  compact={multiDeviceView && dashboardWorkspaceIds.length > 1}
                  onStreamingChange={(streaming) => {
                    setIosStreaming((current) => (
                      current[iosDevice.udid] === streaming
                        ? current
                        : { ...current, [iosDevice.udid]: streaming }
                    ))
                  }}
                />
              ) : (
              <DashboardLayout
              devices={devices}
              activeDevice={serial}
              runningDevices={runningDevices}
              customPath={config.scrcpyPath}
              outputDir={screenshot.screenshotDir}
              config={{ ...config, device: serial }}
              setConfig={setConfig}
              onSelectDevice={openDeviceWorkspace}
              onAddDevice={() => setIsPairingOpen(true)}
              onInstallApk={handleInstallApkBrowse}
              onOpenSettings={() => handleNavigate('settings')}
              onOpenFileExplorer={() => handleNavigate('file-explorer')}
              onOpenWirelessAdb={() => handleNavigate('wireless-adb')}
              onStart={() => void runScrcpy({ ...config, device: serial })}
              onStop={() => void stopScrcpy(serial)}
              isRunning={runningDevices.includes(serial)}
              onScreenshot={() => handleScreenshotCapture(serial)}
              onScreenshotSecondary={(serial) => handleScreenshotCapture(serial)}
              screenshotBusy={screenshot.isCapturing}
              sessionBehavior={sessionBehavior}
              screenshotPanel={renderScreenshotManager(true)}
              logPanel={renderDashboardLogPanel(serial, serial === activeDevice)}
              controlPanel={controlPanel}
              advancedTools={
                <>
                  {deviceToolbar}
                  <div className="mt-4"><ShortcutsPanel /></div>
                </>
              }
              notify={notify}
              onEmbeddedSessionChange={(connected) => {
                setEmbeddedConnections((current) => (
                  current[serial] === connected ? current : { ...current, [serial]: connected }
                ))
              }}
              embeddedSessionCommand={embeddedSessionCommands[serial]}
              onRequestEmbeddedSession={(action) => requestEmbeddedSession(action, serial)}
              compactWorkspace={multiDeviceView && dashboardWorkspaceIds.length > 1}
              />
              )}
            </div>
            )})}
          </div>
          {activeWorkspaceTool && activeWorkspaceTool !== 'file-explorer' ? (
            <WorkspaceToolSurface tool={activeWorkspaceTool}>
              {activeIosUdid ? iosToolUnavailable : activeWorkspaceTool === 'test-runner' ? (
                <TestRunnerPanel
                  activeDevice={activeDevice}
                  customPath={config.scrcpyPath}
                  outputDir={screenshot.screenshotDir}
                />
              ) : activeWorkspaceTool === 'logcat' ? (
                <LogcatViewer
                  embedded
                  isOpen={false}
                  onClose={() => undefined}
                  activeDevice={activeDevice}
                  customPath={config.scrcpyPath}
                  notify={notify}
                />
              ) : (
                workspaceShellPanel
              )}
            </WorkspaceToolSurface>
          ) : activeRoute !== 'dashboard' ? (
            <Suspense
            fallback={
              <div
                role="status"
                className="flex min-h-72 flex-1 items-center justify-center text-[var(--font-size-body-sm)] text-[var(--text-subtle)]"
              >
                Loading page…
              </div>
            }
          >
            <OtherPages
            route={activeRoute}
            devices={
              <DevicesPage
                devices={devices}
                activeDevice={activeDevice}
                runningDevices={runningDevices}
                customPath={config.scrcpyPath}
                isRefreshing={isRefreshing}
                onRefresh={handleRefresh}
                onAddDevice={() => setIsPairingOpen(true)}
                onSelectDevice={setActiveDevice}
                onView={(serial) => {
                  openDeviceWorkspace(serial)
                }}
                onControl={(serial) => {
                  setActiveDevice(serial)
                  void runScrcpy({ ...config, device: serial })
                }}
                onFile={(serial) => {
                  setActiveDevice(serial)
                  setIsFileManagerOpen(true)
                }}
                onShell={(serial) => {
                  setActiveDevice(serial)
                  selectWorkspaceTool('shell')
                }}
                onMore={(serial) => {
                  setActiveDevice(serial)
                  setIsDeviceStatusOpen(true)
                }}
                connectionTools={deviceSidebar}
                iosDevices={ios.devices}
                iosReady={ios.support.supported && ios.support.found}
                onViewIos={openIosWorkspace}
              />
            }
            sessions={
              <SessionsPage
                runningDevices={runningDevices}
                activeSessions={sessionHistory.activeSessions}
                history={sessionHistory.history}
                activeDevice={activeDevice}
                customPath={config.scrcpyPath}
                onSelectDevice={setActiveDevice}
                onView={(serial) => {
                  openDeviceWorkspace(serial)
                }}
                onStop={(serial) => void stopScrcpy(serial)}
                onRunAgain={(entry) => {
                  setActiveDevice(entry.deviceSerial)
                  setConfig(entry.config)
                  persistScrcpyLaunchConfig(localStorage, {
                    ...entry.config,
                    device: entry.deviceSerial,
                  })
                  void runScrcpy(entry.config)
                }}
                onClearHistory={sessionHistory.clearHistory}
                settings={
                  <div className="space-y-4">
                    {controlPanel}
                    {sessionBehavior}
                    <div className="h-72 overflow-hidden rounded-xl border border-[var(--border-subtle)]">{logPanel}</div>
                  </div>
                }
              />
            }
            screenshots={
              <ScreenshotsPage
                history={screenshot.history}
                screenshotDir={screenshot.screenshotDir}
                canCapture={!!activeDevice}
                isCapturing={screenshot.isCapturing}
                onCapture={() => handleScreenshotCapture()}
                onChangeDirectory={handleChangeScreenshotDir}
                onOpenImage={(path) => handleScreenshotAction(screenshot.openImage, path)}
                onOpenFolder={(path) => handleScreenshotAction(screenshot.openFolder, path)}
                onCopyImage={async (path) => {
                  try {
                    await screenshot.copyToClipboard(path)
                    notify(t('screenshot.copiedTitle'), t('screenshot.copiedMessage'), 'success')
                  } catch (error) {
                    notify(t('screenshot.actionFailedTitle'), String(error), 'error')
                  }
                }}
                onDeleteEntry={(id) => screenshot.deleteEntry(id)}
                onClearHistory={screenshot.clearHistory}
              />
            }
            recordings={
              <RecordingsPage
                deviceControls={deviceToolbar}
                activeDevice={activeDevice}
                isRunning={sessionRunning}
                recordPath={config.recordPath}
                onChangeRecordPath={handleChangeRecordPath}
                onOpenDashboard={() => handleNavigate('dashboard')}
                history={recordingLibrary.history}
                onOpenRecording={(path) => void recordingLibrary.openRecording(path)}
                onRevealRecording={(path) => void recordingLibrary.revealRecording(path)}
                onRemoveEntry={(id, deleteFile) => void recordingLibrary.removeEntry(id, deleteFile)}
                onClearHistory={recordingLibrary.clearHistory}
              />
            }
            fileExplorer={
              <FileExplorerPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                manager={
                  activeIosUdid ? iosToolUnavailable : <FileManager
                    embedded
                    isOpen={false}
                    onClose={() => undefined}
                    activeDevice={activeDevice}
                    customPath={config.scrcpyPath}
                    defaultDownloadDir={screenshot.screenshotDir}
                    confirmAction={confirmAction}
                    notify={notify}
                  />
                }
              />
            }
            wirelessAdb={
              <WirelessAdbPage
                activeDevice={activeDevice}
                historyDevices={historyDevices}
                isAutoConnect={isAutoConnect}
                onToggleAuto={toggleAutoConnect}
                onConnect={(address) => connectDevice(address)}
                onOpenAdvanced={() => setIsPairingOpen(true)}
              />
            }
            appManager={
              <AppManagerPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                notify={notify}
                confirmAction={confirmAction}
                onInstallApk={handleInstallApkBrowse}
              />
            }
            logcatViewer={
              <LogcatViewerPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                notify={notify}
              />
            }
            performance={
              <PerformancePage
                connected={!activeIosUdid && sessionRunning}
                bitrateMbps={config.bitrate}
                adaptiveEnabled={
                  config.qualityMode === 'adaptive' ||
                  config.qualityMode === 'quality' ||
                  config.qualityMode === 'balanced'
                }
                onApplySaferProfile={(profile) => {
                  const nextConfig = applyQualityMode({ ...config, qualityMode: profile })
                  setConfig(nextConfig)
                  if (activeDevice) persistScrcpyLaunchConfig(localStorage, {
                    ...nextConfig,
                    device: activeDevice,
                  })
                  if (sessionRunning && activeDevice) {
                    const serial = activeDevice
                    if (adaptiveRestartTimerRef.current !== null) {
                      window.clearTimeout(adaptiveRestartTimerRef.current)
                    }
                    void stopScrcpy(serial).then(() => {
                      adaptiveRestartTimerRef.current = window.setTimeout(() => {
                        adaptiveRestartTimerRef.current = null
                        if (latestActiveDeviceRef.current === serial) {
                          void runScrcpy(nextConfig)
                        }
                      }, 600)
                    })
                  }
                }}
              />
            }
            inputControl={
              <InputControlPage
                activeDevice={activeAndroidWorkspaceDevice}
                devices={devices}
                customPath={config.scrcpyPath}
                notify={notify}
              />
            }
            automation={
              <AutomationPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                outputDir={screenshot.screenshotDir}
                notify={notify}
              />
            }
            scriptManager={
              <ScriptManagerPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                notify={notify}
              />
            }
            taskScheduler={
              <TaskSchedulerPage
                activeDevice={activeAndroidWorkspaceDevice}
                customPath={config.scrcpyPath}
                outputDir={screenshot.screenshotDir}
                notify={notify}
              />
            }
            settings={
              <SettingsPage
                general={sessionBehavior}
                advanced={controlPanel}
                shortcuts={<ShortcutsPanel />}
                about={
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-black/10 p-5">
                    <h2 className="text-sm font-semibold text-[var(--text-base)]">Mobile Device Studio</h2>
                    <p className="mt-2 text-[10px] text-[var(--text-subtle)]">Version {appVersion}</p>
                    <p className="mt-4 text-[10px] leading-relaxed text-[var(--text-muted)]">Built with scrcpy, Tauri, React, and Lucide. Existing application links and setup help remain available from the top bar.</p>
                  </div>
                }
              />
            }
            />
            </Suspense>
          ) : null}
        </>
      }
    >

        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          binaryStatus={scrcpyStatus}
          onDownload={downloadScrcpy}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          onComplete={completeOnboarding}
        />

        <ThemedModal
          isOpen={alertState.isOpen}
          onClose={() => setAlertState((prev) => ({ ...prev, isOpen: false }))}
          title={alertState.title}
          message={alertState.message}
          kind={alertState.kind}
          actionLabel={alertState.actionLabel}
          onAction={alertState.onAction}
          showCancel={alertState.showCancel}
          cancelLabel={alertState.cancelLabel}
          onCancel={alertState.onCancel}
        />

        <BugReportModal
          isOpen={isBugReportOpen}
          onClose={() => setIsBugReportOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          defaultOutputDir={screenshot.screenshotDir}
          latestScreenshotPath={screenshot.history[0]?.path}
          notify={notify}
        />

        <AppManager
          isOpen={isAppManagerOpen}
          onClose={() => setIsAppManagerOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          notify={notify}
          confirmAction={confirmAction}
          onInstallApk={handleInstallApkBrowse}
        />

        <LogcatViewer
          isOpen={isLogcatOpen}
          onClose={() => setIsLogcatOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          notify={notify}
        />

        <DeepLinkLauncher
          isOpen={isDeepLinkOpen}
          onClose={() => setIsDeepLinkOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          notify={notify}
        />

        <TestSession
          isOpen={isTestSessionOpen}
          onClose={() => setIsTestSessionOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          outputDir={screenshot.screenshotDir}
          notify={notify}
        />

        <UiInspector
          isOpen={isUiInspectorOpen}
          onClose={() => setIsUiInspectorOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
        />

        <DeviceStatus
          isOpen={isDeviceStatusOpen}
          onClose={() => setIsDeviceStatusOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
        />

        <DeviceWorkspace
          isOpen={workspaceModal === 'batch'}
          onClose={() => setWorkspaceModal(null)}
          devices={devices}
          runningDevices={runningDevices}
          baseConfig={config}
          customPath={config.scrcpyPath}
          outputDir={screenshot.screenshotDir}
          notify={notify}
          iosDevices={ios.devices}
          iosReady={ios.support.supported && ios.support.found}
          launchDevice={runScrcpy}
        />

        <EmbeddedDeviceWorkspace
          isOpen={workspaceModal === 'embedded'}
          onClose={() => setWorkspaceModal(null)}
          devices={devices}
          runningDevices={runningDevices}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          outputDir={screenshot.screenshotDir}
          notify={notify}
          onRefreshDevices={handleRefresh}
        />

        <MirrorStage
          isOpen={isMirrorStageOpen}
          deviceName={activeDevice}
          isRunning={sessionRunning}
          stageRef={embeddedMirror.stageRef}
          onClose={handleCloseMirrorStage}
          onRedock={handleRedock}
        />

        <WirelessPairingWizard
          isOpen={isPairingOpen}
          onClose={() => setIsPairingOpen(false)}
          customPath={config.scrcpyPath}
          pairDevice={pairDevice}
          connectDevice={connectDevice}
          discoverConnectAddress={discoverConnectAddress}
          historyDevices={historyDevices}
          isAutoConnect={isAutoConnect}
          onToggleAuto={toggleAutoConnect}
          notify={notify}
        />

        <ConnectionHealth
          isOpen={isConnHealthOpen}
          onClose={() => setIsConnHealthOpen(false)}
          connected={sessionRunning}
          bitrateMbps={config.bitrate}
        />

        <PresetProfiles
          isOpen={isPresetsOpen}
          onClose={() => setIsPresetsOpen(false)}
          activeDevice={activeDevice}
          setConfig={setConfig}
          notify={notify}
        />

        <MacroRecorder
          isOpen={isMacroOpen}
          onClose={() => setIsMacroOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          outputDir={screenshot.screenshotDir}
          notify={notify}
        />

        <CustomCommand
          isOpen={isCustomCmdOpen}
          onClose={() => setIsCustomCmdOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          notify={notify}
        />

        <FileManager
          isOpen={isFileManagerOpen}
          onClose={() => setIsFileManagerOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          defaultDownloadDir={screenshot.screenshotDir}
          confirmAction={confirmAction}
          notify={notify}
        />

        <WidgetLayout
          isOpen={isWidgetLayoutOpen}
          onClose={() => setIsWidgetLayoutOpen(false)}
          devices={devices}
          customPath={config.scrcpyPath}
          baseConfig={config}
          runScrcpy={runScrcpy}
          notify={notify}
        />

        <KeymapController
          isOpen={isKeymapOpen}
          onClose={() => setIsKeymapOpen(false)}
          activeDevice={activeDevice}
          customPath={config.scrcpyPath}
          notify={notify}
        />
    </AppShell>
  )
}

export default function App() {
  return (
    <ShellUiProvider>
      <AppContent />
    </ShellUiProvider>
  )
}
