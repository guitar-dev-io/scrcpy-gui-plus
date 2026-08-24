import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { ChevronLeft, Home, RotateCw, Smartphone, SquareStack, X } from 'lucide-react'
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
import DashboardEmbeddedStage from './components/dashboard/DashboardEmbeddedStage'
import CompanionWorkspaceStage from './components/dashboard/CompanionWorkspaceStage'
import IosWorkspaceStage from './components/dashboard/IosWorkspaceStage'
import WorkspaceTabBar from './components/workspace-tabs'
import WorkspaceToolSurface from './components/workspace-tabs/WorkspaceToolSurface'
import CompareWorkspace from './components/compare/CompareWorkspace'
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
import { CommandPalette } from './components/product-tooling/CommandPalette'
import { ProductToolingPanel } from './components/product-tooling/ProductToolingPanel'
import FileManager from './components/file-manager'
import WidgetLayout from './components/widget-layout'
import KeymapController from './components/keymap-controller'
import DevicesBatchActions from './components/devices/DevicesBatchActions'
import { DEFAULT_SCRCPY_CONFIG, useScrcpy } from './hooks/useScrcpy'
import { useDeviceSelection } from './hooks/useDeviceSelection'
import { useCompanion } from './hooks/useCompanion'
import {
  screenshotHistoryEntryFromResult,
  useScreenshot,
} from './hooks/useScreenshot'
import { useCompareSessions } from './hooks/useCompareSessions'
import { useAutoCapture } from './hooks/useAutoCapture'
import { useRecordingLibrary } from './hooks/useRecordingLibrary'
import { useDeviceStatus } from './hooks/useDeviceStatus'
import { useWorkspaceShell } from './hooks/useWorkspaceShell'
import { useEmbeddedMirror } from './hooks/useEmbeddedMirror'
import { useAdbLiveFrame } from './hooks/useAdbLiveFrame'
import { useActivityTimeline } from './hooks/useActivityTimeline'
import { useDeviceRecoverySnapshot } from './hooks/useDeviceRecoverySnapshot'
import { getAdbLiveFrameDataUrl } from './utils/adbLiveFrame'
import { useIosMirror, type IosDeviceInfo } from './hooks/useIosMirror'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from './utils/tauriEnv'
import { createBugReport } from './services/bugReportService'
import {
  capturePreviewFrame,
  type MacScreenshotTarget,
} from './services/screenshotService'
import { applyQualityMode } from './utils/adaptiveQuality'
import { persistScrcpyLaunchConfig } from './utils/scrcpyLaunch'
import { openWorkspaceModal, type WorkspaceModal } from './types/workspaceModal'
import type { CompanionDevice } from './types/companion'
import type { ScreenshotSourceKind } from './types/screenshot'
import type { DeviceActionId } from './types/deviceControl'
import type {
  MultiDeviceWorkspaceSnapshot,
  RecoveryActionId,
} from './types/productTooling'
import { runDeviceAction } from './services/deviceActionService'
import { fmPull } from './services/fileManagerService'
import { extractApkContents } from './services/apkToolkitService'
import { createStudioCommands } from './services/productCommandService'
import { loadDeviceGroups, saveDeviceGroups } from './services/deviceGroupService'
import { runDeviceBatch } from './utils/deviceBatchRunner'
import { useI18n } from './i18n'
import { ShellUiProvider, useShellUi } from './contexts/ShellUiContext'
import {
  DEVICE_PROFILES_KEY,
  DEVICE_CONFIG_PROFILES_KEY,
  getPreset,
  type DeviceConfigProfileMap,
  type DeviceProfileMap,
} from './types/presetProfiles'
import {
  readWorkspaceRestoreState,
  writeWorkspaceRestoreState,
} from './types/workspaceRestore'

const OtherPages = lazy(() => import('./components/pages/OtherPages'))
const DevicesPage = lazy(() => import('./components/pages/DevicesPage'))
const SessionsPage = lazy(() => import('./components/pages/SessionsPage'))
const ScreenshotsPage = lazy(() => import('./components/pages/ScreenshotsPage'))
const RecordingsPage = lazy(() => import('./components/pages/RecordingsPage'))
const SettingsPage = lazy(() => import('./components/pages/SettingsPage'))
const FileExplorerPage = lazy(
  () => import('./components/pages/FileExplorerPage'),
)
const WirelessAdbPage = lazy(() => import('./components/pages/WirelessAdbPage'))
const AppManagerPage = lazy(() => import('./components/pages/AppManagerPage'))
const LocalApkToolkitPage = lazy(
  () => import('./components/pages/LocalApkToolkitPage'),
)
const SimulatorsPage = lazy(() => import('./components/pages/SimulatorsPage'))
const LogcatViewerPage = lazy(
  () => import('./components/pages/LogcatViewerPage'),
)
const PerformancePage = lazy(() => import('./components/pages/PerformancePage'))
const InputControlPage = lazy(
  () => import('./components/pages/InputControlPage'),
)
const AutomationPage = lazy(() => import('./components/pages/AutomationPage'))
const ScriptManagerPage = lazy(
  () => import('./components/pages/ScriptManagerPage'),
)
const TaskSchedulerPage = lazy(
  () => import('./components/pages/TaskSchedulerPage'),
)

function companionWorkspaceId(device: CompanionDevice): string {
  return `companion:${encodeURIComponent(device.id)}`
}

type ScreenshotSourceOption = {
  id: string
  label: string
  kind: ScreenshotSourceKind
  available?: boolean
  macosTarget?: MacScreenshotTarget
}

function isMacOsTauri(): boolean {
  if (!isTauri() || typeof navigator === 'undefined') return false
  const platform = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  return platform.includes('mac') || userAgent.includes('mac os x')
}

function AppContent() {
  const { t } = useI18n()
  const restoredWorkspace = useMemo(
    () => readWorkspaceRestoreState(window.localStorage),
    [],
  )
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
    registeredDevices,
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
  const registeredDeviceIds = useMemo(
    () => registeredDevices.map((device) => device.id),
    [registeredDevices],
  )
  const restoredAndroidWorkspaces = useMemo(
    () =>
      restoredWorkspace.openAndroidSerials.filter((serial) =>
        registeredDeviceIds.includes(serial),
      ),
    [registeredDeviceIds, restoredWorkspace.openAndroidSerials],
  )
  const {
    selectedDeviceIds,
    toggleDeviceSelection,
    selectAllDevices,
    clearDeviceSelection,
  } = useDeviceSelection({
    registeredDeviceIds,
    initialSelectedDeviceIds: restoredWorkspace.selectedDeviceIds,
  })
  const activity = useActivityTimeline()
  const selectedOnlineDeviceIds = useMemo(() => {
    const online = new Set(
      registeredDevices
        .filter((device) => device.adbState === 'device')
        .map((device) => device.serial),
    )
    return Array.from(selectedDeviceIds).filter((serial) => online.has(serial))
  }, [registeredDevices, selectedDeviceIds])
  const previousDeviceStatesRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const previous = previousDeviceStatesRef.current
    const next: Record<string, string> = {}
    for (const device of registeredDevices) {
      next[device.serial] = device.adbState
      if (previous[device.serial] === device.adbState) continue
      activity.append({
        kind: 'device',
        level: device.adbState === 'device'
          ? 'success'
          : device.adbState === 'offline' || device.adbState === 'unauthorized'
            ? 'warning'
            : 'info',
        title: device.adbState === 'device' ? 'Device connected' : `Device ${device.adbState}`,
        detail: device.detail,
        deviceId: device.serial,
        metadata: { adbState: device.adbState, connectionType: device.connectionType },
      })
    }
    previousDeviceStatesRef.current = next
  }, [activity.append, registeredDevices])
  const companion = useCompanion()
  const physicalAndroidDevices = useMemo(
    () => devices.filter((serial) => !/^emulator-\d+$/.test(serial)),
    [devices],
  )
  const { status: workspaceDeviceStatus } = useDeviceStatus({
    activeDevice,
    customPath: config.scrcpyPath,
    autoRefresh: true,
    enabled: Boolean(activeDevice),
  })
  const activeRecovery = useDeviceRecoverySnapshot(activeDevice)
  const workspaceShell = useWorkspaceShell(runTerminalCommand)
  const [appToolPackage, setAppToolPackage] = useState('')
  const [workspaceShellDraft, setWorkspaceShellDraft] = useState('')
  const recordingLibrary = useRecordingLibrary()
  const appliedDeviceProfileRef = useRef('')
  const latestActiveDeviceRef = useRef(activeDevice)
  const adaptiveRestartTimerRef = useRef<number | null>(null)
  latestActiveDeviceRef.current = activeDevice

  useEffect(
    () => () => {
      if (adaptiveRestartTimerRef.current !== null) {
        window.clearTimeout(adaptiveRestartTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!activeDevice || appliedDeviceProfileRef.current === activeDevice)
      return
    appliedDeviceProfileRef.current = activeDevice
    try {
      const profiles = JSON.parse(
        localStorage.getItem(DEVICE_PROFILES_KEY) || '{}',
      ) as DeviceProfileMap
      const configProfiles = JSON.parse(
        localStorage.getItem(DEVICE_CONFIG_PROFILES_KEY) || '{}',
      ) as DeviceConfigProfileMap
      const preset = profiles[activeDevice]
        ? getPreset(profiles[activeDevice])
        : undefined
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
  const compareSessions = useCompareSessions()
  const adbLiveFrame = useAdbLiveFrame(activeDevice)
  const [selectedScreenshotSourceId, setSelectedScreenshotSourceId] =
    useState('android-adb')
  const iosFrameCacheRef = useRef<Record<string, string>>({})
  const [iosFrameRevision, setIosFrameRevision] = useState(0)
  const autoCapture = useAutoCapture({
    activeDevice,
    customPath: config.scrcpyPath,
    outputDirectory: screenshot.screenshotDir,
    onCompleted: (completed) => {
      screenshot.recordAutoCapture(completed)
      if (!completed.result) return
      if (completed.result.partial) {
        notify(
          t('screenshot.partialCaptureTitle'),
          t('screenshot.partialCaptureMessage', {
            path: completed.result.path,
          }),
          'warning',
        )
      } else {
        notify(
          t('screenshot.captureSuccessTitle'),
          t('screenshot.captureSuccessMessage', {
            path: completed.result.path,
          }),
          'success',
        )
      }
    },
  })
  const captureBusy = screenshot.isCapturing || autoCapture.isActive
  const [quickDiagnosticBusy, setQuickDiagnosticBusy] = useState(false)

  const handleQuickDiagnostic = async () => {
    if (!activeDevice || quickDiagnosticBusy) return
    const outputDir = screenshot.screenshotDir || config.recordPath || ''
    if (!outputDir) {
      notify(
        'Diagnostic bundle',
        'Choose an output directory first.',
        'warning',
      )
      return
    }
    if (
      !window.confirm(
        'Create a diagnostic ZIP containing device information, screenshot, and unfiltered system logcat? Sensitive data may be included.',
      )
    )
      return
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
          recordingLibrary.history.find(
            (entry) => entry.deviceSerial === activeDevice,
          )?.path,
        ),
        recordingPath: recordingLibrary.history.find(
          (entry) => entry.deviceSerial === activeDevice,
        )?.path,
        customPath: config.scrcpyPath,
      })
      notify(
        result.success ? 'Diagnostic bundle ready' : 'Diagnostic bundle failed',
        result.success ? result.zipPath : result.error || 'Unknown error',
        result.success
          ? result.warnings.length
            ? 'warning'
            : 'success'
          : 'error',
      )
    } catch (error) {
      notify('Diagnostic bundle failed', String(error), 'error')
    } finally {
      setQuickDiagnosticBusy(false)
    }
  }

  const embeddedMirror = useEmbeddedMirror()
  const [isMirrorStageOpen, setIsMirrorStageOpen] = useState(false)
  const [embeddedConnections, setEmbeddedConnections] = useState<
    Record<string, boolean>
  >({})
  const [openCompanionWorkspaceId, setOpenCompanionWorkspaceId] = useState<
    string | null
  >(null)
  const [activeCompanionWorkspaceId, setActiveCompanionWorkspaceId] = useState<
    string | null
  >(null)
  const [openDeviceWorkspaces, setOpenDeviceWorkspaces] = useState<string[]>(
    () => restoredAndroidWorkspaces,
  )
  const [deviceWorkspaceLabels, setDeviceWorkspaceLabels] = useState<
    Record<string, string>
  >({})
  const [multiDeviceView, setMultiDeviceView] = useState(
    restoredWorkspace.multiDeviceView && restoredAndroidWorkspaces.length > 1,
  )
  const [workspaceRestoreReady, setWorkspaceRestoreReady] = useState(
    () =>
      registeredDeviceIds.length > 0 ||
      (restoredWorkspace.openAndroidSerials.length === 0 &&
        restoredWorkspace.selectedDeviceIds.length === 0),
  )
  const [embeddedSessionCommands, setEmbeddedSessionCommands] = useState<
    Record<string, { id: number; action: 'start' | 'stop' }>
  >({})
  const embeddedDashboardConnected = Boolean(
    activeDevice && embeddedConnections[activeDevice],
  )

  const restoredActiveDeviceRef = useRef(false)
  useEffect(() => {
    if (restoredActiveDeviceRef.current) return
    if (!workspaceRestoreReady) {
      if (registeredDeviceIds.length === 0) return
      setOpenDeviceWorkspaces(restoredAndroidWorkspaces)
      selectAllDevices(restoredWorkspace.selectedDeviceIds)
      setMultiDeviceView(
        restoredWorkspace.multiDeviceView &&
          restoredAndroidWorkspaces.length > 1,
      )
      setWorkspaceRestoreReady(true)
    }
    restoredActiveDeviceRef.current = true
    const restoredActive = restoredWorkspace.activeAndroidSerial
    const restoredOpen = workspaceRestoreReady
      ? openDeviceWorkspaces
      : restoredAndroidWorkspaces
    if (restoredActive && restoredOpen.includes(restoredActive)) {
      setActiveDevice(restoredActive)
    }
  }, [
    openDeviceWorkspaces,
    registeredDeviceIds.length,
    restoredAndroidWorkspaces,
    restoredWorkspace,
    selectAllDevices,
    setActiveDevice,
    workspaceRestoreReady,
  ])

  useEffect(() => {
    if (!workspaceRestoreReady) return
    try {
      writeWorkspaceRestoreState(window.localStorage, {
        version: 1,
        openAndroidSerials: openDeviceWorkspaces,
        selectedDeviceIds: Array.from(selectedDeviceIds),
        activeAndroidSerial: activeDevice || undefined,
        multiDeviceView,
      })
    } catch {
      // Logical workspace remains usable when local storage is unavailable.
    }
  }, [
    activeDevice,
    multiDeviceView,
    openDeviceWorkspaces,
    selectedDeviceIds,
    workspaceRestoreReady,
  ])

  const requestEmbeddedSession = (
    action: 'start' | 'stop',
    serial = activeDevice,
  ) => {
    if (!serial) return
    setEmbeddedSessionCommands((current) => ({
      ...current,
      [serial]: { id: (current[serial]?.id ?? 0) + 1, action },
    }))
  }

  const openDeviceWorkspace = (serial: string) => {
    setOpenDeviceWorkspaces((current) =>
      current.includes(serial) ? current : [...current, serial],
    )
    setActiveDevice(serial)
    setActiveIosUdid(null)
    setActiveCompanionWorkspaceId(null)
    activateDeviceWorkspace()
    handleNavigate('dashboard')
  }

  const closeDeviceWorkspace = (serial: string) => {
    if (embeddedConnections[serial]) requestEmbeddedSession('stop', serial)
    if (runningDevices.includes(serial)) void stopScrcpy(serial)
    setEmbeddedConnections((current) => ({ ...current, [serial]: false }))
    const remaining = Array.from(
      new Set([...openDeviceWorkspaces, ...runningDevices]),
    ).filter((item) => item !== serial)
    setOpenDeviceWorkspaces((current) =>
      current.filter((item) => item !== serial),
    )
    if (serial === activeDevice)
      setActiveDevice(remaining[remaining.length - 1] ?? '')
  }

  useEffect(() => {
    const connected = Object.entries(embeddedConnections)
      .filter(([, value]) => value)
      .map(([serial]) => serial)
    if (connected.length === 0) return
    setOpenDeviceWorkspaces((current) =>
      Array.from(new Set([...current, ...connected])),
    )
  }, [embeddedConnections])

  useEffect(() => {
    if (
      !activeDevice ||
      workspaceDeviceStatus?.serial !== activeDevice ||
      !workspaceDeviceStatus.model
    )
      return
    const model = workspaceDeviceStatus.model
    setDeviceWorkspaceLabels((current) =>
      current[activeDevice] === model
        ? current
        : { ...current, [activeDevice]: model },
    )
  }, [
    activeDevice,
    workspaceDeviceStatus?.model,
    workspaceDeviceStatus?.serial,
  ])

  const ios = useIosMirror(config.scrcpyPath)
  const [openIosWorkspaces, setOpenIosWorkspaces] = useState<string[]>([])
  const [iosWorkspaceDevices, setIosWorkspaceDevices] = useState<
    Record<string, IosDeviceInfo>
  >({})
  const [activeIosUdid, setActiveIosUdid] = useState<string | null>(null)
  const [iosStreaming, setIosStreaming] = useState<Record<string, boolean>>({})
  const handleIosFrame = useCallback(
    (udid: string, frameSrc: string | null) => {
      if (frameSrc) {
        if (iosFrameCacheRef.current[udid] === frameSrc) return
        iosFrameCacheRef.current[udid] = frameSrc
      } else {
        if (!(udid in iosFrameCacheRef.current)) return
        delete iosFrameCacheRef.current[udid]
      }
      setIosFrameRevision((current) => current + 1)
    },
    [],
  )
  const activeAndroidWorkspaceDevice =
    activeIosUdid || activeCompanionWorkspaceId ? '' : activeDevice

  const openIosWorkspace = (device: IosDeviceInfo) => {
    setOpenIosWorkspaces((current) =>
      current.includes(device.udid) ? current : [...current, device.udid],
    )
    setIosWorkspaceDevices((current) => ({ ...current, [device.udid]: device }))
    setActiveIosUdid(device.udid)
    setActiveCompanionWorkspaceId(null)
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

  const companionDevicesByWorkspaceId = useMemo(
    () =>
      new Map(
        companion.devices.map(
          (device) => [companionWorkspaceId(device), device] as const,
        ),
      ),
    [companion.devices],
  )

  const selectCompanionWorkspace = (workspaceId: string) => {
    if (!companionDevicesByWorkspaceId.has(workspaceId)) return
    setActiveCompanionWorkspaceId(workspaceId)
    setActiveIosUdid(null)
    activateDeviceWorkspace()
    handleNavigate('dashboard')
  }

  const openCompanionWorkspace = (device: CompanionDevice) => {
    const workspaceId = companionWorkspaceId(device)
    setOpenCompanionWorkspaceId(workspaceId)
    selectCompanionWorkspace(workspaceId)

    const canShareScreen =
      device.transport === 'lan-tcp' &&
      device.capabilities.includes('start_screen_share')
    if (
      canShareScreen &&
      (companion.screenState === 'stopped' || companion.screenState === 'error')
    ) {
      void companion.startScreen().catch(() => undefined)
    }
  }

  const closeCompanionWorkspace = (workspaceId: string) => {
    setOpenCompanionWorkspaceId((current) =>
      current === workspaceId ? null : current,
    )
    setActiveCompanionWorkspaceId((current) =>
      current === workspaceId ? null : current,
    )
  }

  useEffect(() => {
    if (
      !openCompanionWorkspaceId ||
      companionDevicesByWorkspaceId.has(openCompanionWorkspaceId)
    ) {
      return
    }
    setOpenCompanionWorkspaceId(null)
    setActiveCompanionWorkspaceId((current) =>
      current === openCompanionWorkspaceId ? null : current,
    )
  }, [companionDevicesByWorkspaceId, openCompanionWorkspaceId])

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
  const [isProductToolingOpen, setIsProductToolingOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [workspaceModal, setWorkspaceModal] = useState<WorkspaceModal>(null)
  const [workspaceDeviceScope, setWorkspaceDeviceScope] = useState<
    string[] | null
  >(null)
  const [deviceBatchBusy, setDeviceBatchBusy] = useState(false)
  const workspaceDevices = useMemo(
    () =>
      workspaceDeviceScope
        ? workspaceDeviceScope.filter((serial) => devices.includes(serial))
        : devices,
    [devices, workspaceDeviceScope],
  )
  const [isPairingOpen, setIsPairingOpen] = useState(false)
  const [isConnHealthOpen, setIsConnHealthOpen] = useState(false)
  const [isPresetsOpen, setIsPresetsOpen] = useState(false)
  const [isMacroOpen, setIsMacroOpen] = useState(false)
  const [isCustomCmdOpen, setIsCustomCmdOpen] = useState(false)

  const openSelectedDeviceWorkspace = () => {
    if (selectedOnlineDeviceIds.length === 0) return
    setWorkspaceDeviceScope(selectedOnlineDeviceIds)
    setWorkspaceModal('embedded')
  }

  const openSelectedDeviceBatchTools = () => {
    if (selectedOnlineDeviceIds.length === 0) return
    setWorkspaceDeviceScope([...selectedOnlineDeviceIds])
    setWorkspaceModal('batch')
  }

  const closeWorkspaceModal = () => {
    setWorkspaceModal(null)
    setWorkspaceDeviceScope(null)
  }

  const runSelectedDeviceAction = async (
    action: Extract<
      DeviceActionId,
      | 'home'
      | 'back'
      | 'power'
      | 'volume_up'
      | 'volume_down'
      | 'mute'
      | 'reboot'
    >,
    deviceIds: readonly string[] = selectedOnlineDeviceIds,
  ) => {
    if (deviceIds.length === 0 || deviceBatchBusy) return
    setDeviceBatchBusy(true)
    try {
      const run = await runDeviceBatch(
        deviceIds,
        (serial) => runDeviceAction(serial, action, config.scrcpyPath),
        { concurrency: 3 },
      )
      const actionFailures = run.results.filter(
        (result) => result.status === 'success' && !result.value.success,
      ).length
      const failed = run.summary.failed + run.summary.cancelled + actionFailures
      const succeeded = run.summary.total - failed
      notify(
        failed === 0 ? 'Device action complete' : 'Device action completed',
        failed === 0
          ? `${action} sent to ${run.summary.total} device(s).`
          : `${succeeded} succeeded, ${failed} failed.`,
        failed === 0 ? 'success' : 'warning',
      )
    } finally {
      setDeviceBatchBusy(false)
    }
  }
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

  const confirmSelectedDeviceReboot = () => {
    const deviceIds = [...selectedOnlineDeviceIds]
    if (deviceIds.length === 0 || deviceBatchBusy) return
    confirmAction(
      'Reboot selected devices',
      `Reboot ${deviceIds.length} online selected device${deviceIds.length === 1 ? '' : 's'}?\n\n${deviceIds.join('\n')}\n\nThe devices will be temporarily unavailable while restarting.`,
      () => void runSelectedDeviceAction('reboot', deviceIds),
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

  const openMultiDeviceApkInstall = () => {
    setWorkspaceDeviceScope(null)
    setWorkspaceModal('batch')
  }

  const installLocalApkOnCurrent = async (filePath: string) => {
    if (!activeAndroidWorkspaceDevice) {
      notify('No Android device selected', 'Select an online Android device before installing the APK.', 'warning')
      return
    }
    const result = await installApk(activeAndroidWorkspaceDevice, filePath, config.scrcpyPath)
    notify(
      result?.success === false ? 'APK install failed' : 'APK installed',
      result?.message ? String(result.message) : `${filePath} → ${activeAndroidWorkspaceDevice}`,
      result?.success === false ? 'error' : 'success',
    )
  }

  const installLocalApkOnSelected = async (filePath: string) => {
    const targets = selectedOnlineDeviceIds.slice(0, 9)
    if (targets.length === 0) {
      notify('No selected devices', 'Select at least one online Android device before installing the APK.', 'warning')
      return
    }
    const run = await runDeviceBatch(
      targets,
      async (serial) => {
        const result = await invoke<{ success?: boolean; error?: string; message?: string }>('install_apk', {
          device: serial,
          filePath,
          customPath: config.scrcpyPath,
        })
        if (result.success === false) throw new Error(result.error || result.message || 'APK install failed')
        return result
      },
      { concurrency: 3 },
    )
    notify(
      run.summary.failed === 0 ? 'APK installed' : 'APK install completed with failures',
      `${run.summary.succeeded} succeeded, ${run.summary.failed + run.summary.cancelled} failed${selectedOnlineDeviceIds.length > 9 ? ' (limited to 9 devices)' : ''}.`,
      run.summary.failed === 0 ? 'success' : 'warning',
    )
  }

  const extractLocalApkContents = async (filePath: string) => {
    const outputDirectory = await open({
      directory: true,
      multiple: false,
      title: 'Extract APK contents',
    })
    if (typeof outputDirectory !== 'string') return
    const result = await extractApkContents(filePath, outputDirectory)
    notify(
      result.success ? 'APK contents extracted' : 'APK extraction failed',
      result.success
        ? `${result.extractedFiles} files extracted to ${result.outputPath}`
        : result.error || 'Unknown extraction error',
      result.success ? 'success' : 'error',
    )
  }

  const handleScreenshotCapture = async (serial?: string) => {
    if (autoCapture.isActive) return
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

  const handleScreenshotDelete = async (id: string, deleteFile: boolean) => {
    const result = await screenshot.deleteEntry(id, deleteFile)
    const failure = result.failures[0]
    if (failure) {
      notify(
        t('screenshot.actionFailedTitle'),
        t('screenshot.deleteFailedMessage', {
          filename: failure.filename,
          error: failure.error,
        }),
        'error',
      )
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
        if (activeDevice && !captureBusy) {
          handleScreenshotCapture()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice, captureBusy])

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
      companionDevices={companion.devices}
      companionScanning={companion.isScanning}
      companionPairing={companion.isPairing}
      companionLanOffer={companion.lanOffer}
      companionError={companion.error}
      companionStatus={companion.status}
      companionScreenStatus={companion.screenStatus}
      companionScreenFrame={companion.screenFrame}
      companionScreenStarting={companion.isScreenStarting}
      companionScreenStreaming={companion.isScreenStreaming}
      onCompanionScan={companion.scan}
      onCompanionStartLanPairing={companion.startLanPairing}
      onCompanionScreenStart={companion.startScreen}
      onCompanionScreenStop={companion.stopScreen}
      onCompanionDisconnect={companion.disconnect}
      onCompanionRequest={companion.request}
      companionRemoteStatus={companion.remoteStatus}
      companionRemoteStarting={companion.isRemoteStarting}
      companionRemoteActive={companion.isRemoteActive}
      companionEmbeddedConnections={embeddedConnections}
      companionCustomPath={config.scrcpyPath}
      onCompanionRemoteStart={companion.startRemote}
      onCompanionRemoteStop={companion.stopRemote}
      onOpenWorkspace={() => {
        setWorkspaceDeviceScope(null)
        setWorkspaceModal((current) => openWorkspaceModal(current, 'embedded'))
      }}
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
          res.success ? 'pymobiledevice3 installed successfully.' : res.message,
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
      isCapturing={captureBusy}
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
      onOpenEmbeddedWorkspace={() => {
        setWorkspaceDeviceScope(null)
        setWorkspaceModal((current) => openWorkspaceModal(current, 'embedded'))
      }}
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

  const sessionBehavior = (
    <SessionBehavior config={config} setConfig={setConfig} />
  )

  const renderScreenshotManager = (dashboard = false) => (
    <ScreenshotManager
      dashboard={dashboard}
      history={screenshot.history}
      screenshotDir={screenshot.screenshotDir}
      isCapturing={captureBusy}
      canCapture={!!activeDevice}
      shortcutLabel={
        navigator.platform.toLowerCase().includes('mac')
          ? 'Cmd+Shift+S'
          : 'Ctrl+Shift+S'
      }
      onCapture={() => handleScreenshotCapture()}
      onChangeDirectory={handleChangeScreenshotDir}
      onOpenImage={(path) => handleScreenshotAction(screenshot.openImage, path)}
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
      onDeleteEntry={handleScreenshotDelete}
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

  const renderDashboardLogPanel = (serial: string, enabled: boolean) =>
    dashboardBottomTab === 'logcat' ? (
      <CompactLogcatPanel
        activeDevice={serial}
        customPath={config.scrcpyPath}
        enabled={enabled && activeRoute === 'dashboard' && !activeWorkspaceTool}
      />
    ) : (
      <LogPanel
        dashboard
        mode={
          dashboardBottomTab === 'test-runner' ? 'logcat' : dashboardBottomTab
        }
        logs={dashboardBottomTab === 'shell' ? workspaceShell.logs : logs}
        stableEntries={
          dashboardBottomTab === 'shell' ? workspaceShell.entries : undefined
        }
        onClear={
          dashboardBottomTab === 'shell' ? workspaceShell.clear : clearLogs
        }
        onAddLog={
          dashboardBottomTab === 'shell'
            ? workspaceShell.addLog
            : (message) =>
                setLogs((prev: string[]) => [...prev.slice(-100), message])
        }
        onRunCommand={
          dashboardBottomTab === 'shell'
            ? workspaceShell.runCommand
            : runTerminalCommand
        }
      />
    )

  const embeddedRunningDevices = Object.entries(embeddedConnections)
    .filter(([, connected]) => connected)
    .map(([serial]) => serial)
  const dashboardWorkspaceSerials = Array.from(
    new Set([...openDeviceWorkspaces, ...(activeDevice ? [activeDevice] : [])]),
  )
  const iosDevicesByUdid = new Map(
    [...Object.values(iosWorkspaceDevices), ...ios.devices].map((device) => [
      device.udid,
      device,
    ]),
  )
  const companionWorkspaceIds =
    openCompanionWorkspaceId &&
    companionDevicesByWorkspaceId.has(openCompanionWorkspaceId)
      ? [openCompanionWorkspaceId]
      : []
  const dashboardWorkspaceIds = Array.from(
    new Set([
      ...dashboardWorkspaceSerials,
      ...openIosWorkspaces.filter((udid) => iosDevicesByUdid.has(udid)),
      ...companionWorkspaceIds,
    ]),
  )
  const activeWorkspaceDevice =
    activeCompanionWorkspaceId ?? activeIosUdid ?? activeDevice
  const renderedDashboardWorkspaceIds = multiDeviceView
    ? dashboardWorkspaceIds
    : activeWorkspaceDevice
      ? [activeWorkspaceDevice]
      : []
  const iosRunningDevices = Object.entries(iosStreaming)
    .filter(([, streaming]) => streaming)
    .map(([udid]) => udid)
  const companionRunningDevices =
    companion.isScreenStreaming && openCompanionWorkspaceId
      ? [openCompanionWorkspaceId]
      : []
  const workspaceDeviceLabels = {
    ...deviceWorkspaceLabels,
    ...Object.fromEntries(
      Array.from(iosDevicesByUdid.values()).map((device) => [
        device.udid,
        device.name || device.productType,
      ]),
    ),
    ...Object.fromEntries(
      Array.from(companionDevicesByWorkspaceId.entries()).map(
        ([workspaceId, device]) => [
          workspaceId,
          device.name || 'Android Companion',
        ],
      ),
    ),
  }
  const workspaceDeviceKinds = Object.fromEntries([
    ...dashboardWorkspaceSerials.map((serial) => [serial, 'android'] as const),
    ...openIosWorkspaces.map((udid) => [udid, 'ios'] as const),
    ...companionWorkspaceIds.map(
      (workspaceId) => [workspaceId, 'companion'] as const,
    ),
  ])

  const screenshotCaptureSources = useMemo<ScreenshotSourceOption[]>(() => {
    const sources: ScreenshotSourceOption[] = []
    if (activeDevice) {
      sources.push({
        id: 'android-adb',
        label: `Android ADB · ${workspaceDeviceLabels[activeDevice] || activeDevice}`,
        kind: 'android-adb',
      })
    }
    if (activeDevice && adbLiveFrame.active) {
      sources.push({
        id: 'embedded-scrcpy',
        label: `Embedded scrcpy · ${workspaceDeviceLabels[activeDevice] || activeDevice}`,
        kind: 'embedded-scrcpy',
      })
    }
    if (activeIosUdid && iosFrameCacheRef.current[activeIosUdid]) {
      const device = iosDevicesByUdid.get(activeIosUdid)
      sources.push({
        id: `ios:${activeIosUdid}`,
        label: `iOS · ${device?.name || device?.productType || activeIosUdid}`,
        kind: 'ios',
      })
    }
    if (
      activeCompanionWorkspaceId &&
      companion.isScreenStreaming &&
      companion.screenFrame
    ) {
      const device = companionDevicesByWorkspaceId.get(
        activeCompanionWorkspaceId,
      )
      sources.push({
        id: activeCompanionWorkspaceId,
        label: `Android Companion · ${device?.name || 'device'}`,
        kind: 'android-companion',
      })
    }
    if (isMacOsTauri()) {
      sources.push(
        {
          id: 'macos-display',
          label: 'macOS · Main display',
          kind: 'macos-display',
          macosTarget: 'display',
        },
        {
          id: 'macos-window',
          label: 'macOS · Select window',
          kind: 'macos-window',
          macosTarget: 'window',
        },
        {
          id: 'macos-region',
          label: 'macOS · Select region',
          kind: 'macos-region',
          macosTarget: 'region',
        },
      )
    }
    return sources
  }, [
    activeCompanionWorkspaceId,
    activeDevice,
    activeIosUdid,
    adbLiveFrame.active,
    companion.isScreenStreaming,
    companion.screenFrame,
    companionDevicesByWorkspaceId,
    deviceWorkspaceLabels,
    iosDevicesByUdid,
    iosFrameRevision,
  ])

  useEffect(() => {
    if (
      selectedScreenshotSourceId &&
      screenshotCaptureSources.some(
        (source) => source.id === selectedScreenshotSourceId,
      )
    ) {
      return
    }
    setSelectedScreenshotSourceId(
      screenshotCaptureSources[0]?.id || 'android-adb',
    )
  }, [screenshotCaptureSources, selectedScreenshotSourceId])

  const selectedScreenshotSource = screenshotCaptureSources.find(
    (source) => source.id === selectedScreenshotSourceId,
  )

  const handleScreenshotPageCapture = async () => {
    const source = selectedScreenshotSource
    if (!source || source.kind === 'android-adb') {
      await handleScreenshotCapture()
      return
    }

    if (
      source.kind === 'macos-display' ||
      source.kind === 'macos-window' ||
      source.kind === 'macos-region'
    ) {
      const target = source.macosTarget
      if (!target) return
      const result = await screenshot.captureMac(target)
      if (result.success) {
        notify('Screenshot saved', result.path, 'success')
      } else if (result.errorCode !== 'busy') {
        notify('Screenshot failed', result.error || 'Unknown error', 'error')
      }
      return
    }

    let imageData: string | null = null
    let deviceSerial = source.id
    let deviceName = source.label
    let sourceId = source.id

    if (source.kind === 'embedded-scrcpy') {
      deviceSerial = activeDevice
      deviceName = workspaceDeviceLabels[activeDevice] || activeDevice
      sourceId = activeDevice
      imageData = getAdbLiveFrameDataUrl(activeDevice)?.dataUrl || null
    } else if (source.kind === 'ios') {
      const udid = source.id.slice('ios:'.length)
      const device = iosDevicesByUdid.get(udid)
      deviceSerial = udid
      sourceId = udid
      deviceName = device?.name || device?.productType || udid
      imageData = iosFrameCacheRef.current[udid] || null
    } else if (source.kind === 'android-companion') {
      const device = companionDevicesByWorkspaceId.get(source.id)
      deviceSerial = source.id
      deviceName = device?.name || 'Android Companion'
      imageData = companion.getScreenFrameData()
    }

    if (!imageData) {
      notify(
        'Screenshot failed',
        'The selected source does not have a current frame.',
        'warning',
      )
      return
    }

    const result = await screenshot.captureExternal({
      imageData,
      deviceSerial,
      deviceName,
      sourceKind: source.kind,
      sourceId,
      sourceName: source.label,
      outputDir: screenshot.screenshotDir,
    })
    if (result.success) {
      notify('Screenshot saved', result.path, 'success')
    } else if (result.errorCode !== 'busy') {
      notify('Screenshot failed', result.error || 'Unknown error', 'error')
    }
  }

  const handleCaptureAllSelected = async () => {
    if (selectedOnlineDeviceIds.length < 2) return
    const results = await screenshot.captureMany(selectedOnlineDeviceIds)
    const successful = results.filter((result) => result.success)
    const session = compareSessions.createSession(
      successful.map((result) => screenshotHistoryEntryFromResult(result)),
    )
    const failed = results.length - successful.length
    notify(
      session ? 'Capture All complete' : 'Capture All incomplete',
      `${successful.length} captured, ${failed} failed.${session ? ' Compare workspace opened.' : ' At least two successful captures are required.'}`,
      failed === 0 && session ? 'success' : 'warning',
    )
    if (session) selectWorkspaceTool('compare')
  }

  const workspaceShellPanel = (
    <LogPanel
      dashboard
      mode="shell"
      logs={workspaceShell.logs}
      stableEntries={workspaceShell.entries}
      onClear={workspaceShell.clear}
      onAddLog={workspaceShell.addLog}
      onRunCommand={workspaceShell.runCommand}
      initialCommand={workspaceShellDraft}
    />
  )

  const openPackageLogcat = (packageName: string) => {
    setAppToolPackage(packageName)
    handleNavigate('logcat-viewer')
  }

  const openPackageShell = (packageName: string) => {
    setWorkspaceShellDraft(`shell run-as ${packageName} pwd`)
    workspaceShell.addLog(`[Package context] ${packageName}`)
    handleNavigate('dashboard')
    selectWorkspaceTool('shell')
  }

  const pullPackageApk = async (packageName: string, remotePath: string) => {
    if (!activeAndroidWorkspaceDevice) return
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: screenshot.screenshotDir || undefined,
        title: `Save ${packageName} APK`,
      })
      if (typeof selected !== 'string') return
      const result = await fmPull(
        activeAndroidWorkspaceDevice,
        remotePath,
        selected,
        config.scrcpyPath,
        `${packageName}.apk`,
      )
      if (result.success) {
        notify('APK saved', result.path || selected, 'success')
      } else {
        notify('Pull APK failed', result.error || 'Unknown error', 'error')
      }
    } catch (error) {
      notify('Pull APK failed', error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const currentWorkspaceSnapshot = (): MultiDeviceWorkspaceSnapshot => {
    const groupAssignments: Record<string, string> = {}
    for (const group of loadDeviceGroups(localStorage).groups) {
      for (const deviceId of group.deviceIds) groupAssignments[deviceId] = group.id
    }
    return {
      deviceSerials: registeredDevices.map((device) => device.serial),
      selectedSerials: Array.from(selectedDeviceIds),
      groupAssignments,
    }
  }

  const applyWorkspacePreset = (snapshot: MultiDeviceWorkspaceSnapshot) => {
    const available = new Set(registeredDeviceIds)
    const deviceSerials = snapshot.deviceSerials.filter((serial) => available.has(serial))
    const selectedSerials = snapshot.selectedSerials.filter((serial) => available.has(serial))
    const document = loadDeviceGroups(localStorage)
    const presetDevices = new Set(snapshot.deviceSerials)
    const groups = document.groups.map((group) => ({
      ...group,
      deviceIds: group.deviceIds.filter((serial) => !presetDevices.has(serial)),
    }))
    for (const [serial, groupId] of Object.entries(snapshot.groupAssignments)) {
      if (!available.has(serial)) continue
      const group = groups.find((candidate) => candidate.id === groupId)
      if (group && !group.deviceIds.includes(serial)) group.deviceIds.push(serial)
    }
    saveDeviceGroups(localStorage, { ...document, groups })
    selectAllDevices(selectedSerials)
    setWorkspaceDeviceScope(deviceSerials)
    setWorkspaceModal('batch')
    activity.append({
      kind: 'operation',
      level: 'success',
      title: 'Workspace preset applied',
      detail: `${deviceSerials.length} available devices restored`,
    })
  }

  const handleProductRecoveryAction = (action: RecoveryActionId, deviceId?: string) => {
    const target = deviceId || activeDevice
    if (target) setActiveDevice(target)
    activity.append({
      kind: 'recovery',
      level: 'info',
      title: `Recovery action: ${action}`,
      deviceId: target || undefined,
    })
    if (action === 'refresh-device' || action === 'retry-recovery') {
      handleRefresh()
    } else if (action === 'restart-adb') {
      void handleKillAdb()
    } else if (action === 'open-logcat') {
      handleNavigate('logcat-viewer')
    } else if (action === 'apply-safe-profile') {
      setConfig((current) => applyQualityMode({
        ...current,
        device: target,
        qualityMode: 'balanced',
      }))
    } else if (action === 'authorize-device') {
      showAlert(
        'Authorize Android device',
        'Unlock the device, accept the USB debugging prompt, then refresh devices.',
        'info',
      )
    }
  }

  const exportProductDiagnostic = async (content: string, name: string) => {
    try {
      const path = await invoke<string>('save_report', { content, name })
      activity.append({
        kind: 'diagnostic',
        level: 'success',
        title: 'Diagnostic bundle exported',
        detail: path,
        deviceId: activeDevice || undefined,
      })
      notify('Diagnostic bundle exported', path, 'success')
    } catch (error) {
      notify('Diagnostic export failed', String(error), 'error')
    }
  }

  const studioCommands = createStudioCommands({
    activeDevice,
    refreshDevices: handleRefresh,
    captureAll: handleCaptureAllSelected,
    openDeviceWorkspace: openMultiDeviceApkInstall,
    openLogcat: (deviceId) => {
      if (deviceId) setActiveDevice(deviceId)
      handleNavigate('logcat-viewer')
    },
    openShell: (deviceId) => {
      if (deviceId) setActiveDevice(deviceId)
      handleNavigate('dashboard')
      selectWorkspaceTool('shell')
    },
    openAppManager: (deviceId) => {
      if (deviceId) setActiveDevice(deviceId)
      handleNavigate('app-manager')
    },
    openDiagnostics: () => setIsProductToolingOpen(true),
  })

  const viewOnlyToolUnavailable = (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
      <Smartphone size={24} className="text-[var(--text-subtle)]" />
      <p className="text-[11px] font-semibold text-[var(--text-muted)]">
        Unavailable for view-only workspaces
      </p>
      <p className="max-w-md text-[9px] leading-relaxed text-[var(--text-subtle)]">
        Logcat, shell, files and Android automation require ADB. Select an
        Android workspace to use this tool.
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
      connected={
        activeIosUdid || activeCompanionWorkspaceId ? false : sessionRunning
      }
      isRefreshing={isRefreshing}
      onRefresh={handleRefresh}
      onOpenSettings={() => handleNavigate('settings')}
      onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
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
      footer={<Footer version={appVersion} />}
      content={
        <>
          <WorkspaceTabBar
            deviceWorkspaces={Array.from(
              new Set([
                ...openDeviceWorkspaces,
                ...runningDevices,
                ...embeddedRunningDevices,
                ...openIosWorkspaces,
                ...companionWorkspaceIds,
              ]),
            )}
            deviceLabels={workspaceDeviceLabels}
            deviceKinds={workspaceDeviceKinds}
            runningDevices={Array.from(
              new Set([
                ...runningDevices,
                ...embeddedRunningDevices,
                ...iosRunningDevices,
                ...companionRunningDevices,
              ]),
            )}
            activeDevice={activeWorkspaceDevice}
            onSelectDevice={(workspaceId) => {
              const companionDevice =
                companionDevicesByWorkspaceId.get(workspaceId)
              if (companionDevice) selectCompanionWorkspace(workspaceId)
              else {
                const iosDevice = iosDevicesByUdid.get(workspaceId)
                if (iosDevice) openIosWorkspace(iosDevice)
                else openDeviceWorkspace(workspaceId)
              }
            }}
            onCloseDevice={(workspaceId) => {
              if (companionDevicesByWorkspaceId.has(workspaceId))
                closeCompanionWorkspace(workspaceId)
              else if (iosDevicesByUdid.has(workspaceId))
                closeIosWorkspace(workspaceId)
              else closeDeviceWorkspace(workspaceId)
            }}
            onAddDevice={() => setIsPairingOpen(true)}
            multiDeviceView={multiDeviceView}
            onToggleMultiDeviceView={() => {
              const androidWorkspaceIds = dashboardWorkspaceIds.filter(
                (workspaceId) => devices.includes(workspaceId),
              )
              if (!multiDeviceView && androidWorkspaceIds.length > 1) {
                setWorkspaceDeviceScope(androidWorkspaceIds)
                setWorkspaceModal('embedded')
                return
              }
              setMultiDeviceView((current) => !current)
            }}
            toolbar={appHeader(true)}
          />
          <div
            aria-hidden={activeRoute !== 'dashboard' ? true : undefined}
            className={
              activeRoute !== 'dashboard' ||
              (activeWorkspaceTool && activeWorkspaceTool !== 'file-explorer')
                ? 'hidden'
                : multiDeviceView && dashboardWorkspaceIds.length > 1
                  ? 'grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 xl:grid-cols-2'
                  : 'contents'
            }
          >
            {(renderedDashboardWorkspaceIds.length > 0
              ? renderedDashboardWorkspaceIds
              : ['']
            ).map((workspaceId) => {
              const companionDevice =
                companionDevicesByWorkspaceId.get(workspaceId)
              const iosDevice = iosDevicesByUdid.get(workspaceId)
              const serial = workspaceId
              const compactMultiDevice =
                multiDeviceView && dashboardWorkspaceIds.length > 1
              const registeredDevice = registeredDevices.find(
                (device) => device.serial === serial,
              )
              return (
                <div
                  key={workspaceId || 'empty-device-workspace'}
                  className={
                    (!multiDeviceView || dashboardWorkspaceIds.length <= 1) &&
                    workspaceId !== activeWorkspaceDevice
                      ? 'hidden'
                      : multiDeviceView && dashboardWorkspaceIds.length > 1
                        ? 'min-h-[430px] min-w-0'
                        : 'contents'
                  }
                  aria-hidden={
                    (!multiDeviceView || dashboardWorkspaceIds.length <= 1) &&
                    workspaceId !== activeWorkspaceDevice
                      ? true
                      : undefined
                  }
                >
                  {companionDevice ? (
                    <CompanionWorkspaceStage
                      device={companionDevice}
                      frame={companion.screenFrame}
                      screenState={companion.screenState}
                      screenStatus={companion.screenStatus}
                      startScreen={companion.startScreen}
                      stopScreen={companion.stopScreen}
                      compact={compactMultiDevice}
                    />
                  ) : iosDevice ? (
                    <IosWorkspaceStage
                      device={iosDevice}
                      customPath={config.scrcpyPath}
                      compact={compactMultiDevice}
                      onStreamingChange={(streaming) => {
                        setIosStreaming((current) =>
                          current[iosDevice.udid] === streaming
                            ? current
                            : { ...current, [iosDevice.udid]: streaming },
                        )
                      }}
                      onFrame={(frameSrc) =>
                        handleIosFrame(iosDevice.udid, frameSrc)
                      }
                    />
                  ) : compactMultiDevice ? (
                    <div
                      className="h-full min-h-[430px] min-w-0"
                      onPointerDown={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            '[aria-label="Unpin secondary device"]',
                          )
                        )
                          return
                        if (serial !== activeDevice) setActiveDevice(serial)
                      }}
                      onFocusCapture={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            '[aria-label="Unpin secondary device"]',
                          )
                        )
                          return
                        if (serial !== activeDevice) setActiveDevice(serial)
                      }}
                    >
                      <DashboardEmbeddedStage
                        compact
                        deviceName={
                          registeredDevice?.health?.model ||
                          deviceWorkspaceLabels[serial] ||
                          serial
                        }
                        deviceSerial={serial}
                        androidVersion={
                          registeredDevice?.health?.androidVersion
                        }
                        connection={
                          registeredDevice?.connectionType.toUpperCase() ||
                          (serial.includes(':') ? 'WIFI' : 'USB')
                        }
                        batteryLevel={registeredDevice?.health?.batteryLevel}
                        customPath={config.scrcpyPath}
                        outputDir={screenshot.screenshotDir}
                        notify={notify}
                        actionRail={
                          <div className="flex flex-col gap-1.5">
                            {(
                              [
                                ['back', 'Back', ChevronLeft],
                                ['home', 'Home', Home],
                                ['recents', 'Recents', SquareStack],
                                ['rotate', 'Rotate', RotateCw],
                              ] as const
                            ).map(([action, label, Icon]) => (
                              <button
                                key={action}
                                type="button"
                                title={label}
                                aria-label={`${label} on ${serial}`}
                                onClick={() => {
                                  void runDeviceAction(
                                    serial,
                                    action,
                                    config.scrcpyPath,
                                  )
                                    .then((result) => {
                                      if (!result.success) {
                                        notify(
                                          `${label} failed`,
                                          result.error || 'Unknown error',
                                          'error',
                                        )
                                      }
                                    })
                                    .catch((error) =>
                                      notify(
                                        `${label} failed`,
                                        String(error),
                                        'error',
                                      ),
                                    )
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-primary/15 hover:text-primary"
                              >
                                <Icon size={14} />
                              </button>
                            ))}
                          </div>
                        }
                        onScreenshot={() =>
                          void handleScreenshotCapture(serial)
                        }
                        screenshotBusy={captureBusy}
                        onAddDevice={() => setIsPairingOpen(true)}
                        onClose={() => closeDeviceWorkspace(serial)}
                        onMetricsChange={({ connected }) => {
                          setEmbeddedConnections((current) =>
                            current[serial] === connected
                              ? current
                              : { ...current, [serial]: connected },
                          )
                        }}
                        sessionCommand={embeddedSessionCommands[serial]}
                      />
                    </div>
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
                      onStart={() =>
                        void runScrcpy({ ...config, device: serial })
                      }
                      onStop={() => void stopScrcpy(serial)}
                      isRunning={runningDevices.includes(serial)}
                      onScreenshot={() => handleScreenshotCapture(serial)}
                      onScreenshotSecondary={(serial) =>
                        handleScreenshotCapture(serial)
                      }
                      screenshotBusy={captureBusy}
                      sessionBehavior={sessionBehavior}
                      screenshotPanel={renderScreenshotManager(true)}
                      logPanel={renderDashboardLogPanel(
                        serial,
                        serial === activeDevice,
                      )}
                      controlPanel={controlPanel}
                      advancedTools={
                        <>
                          {deviceToolbar}
                          <div className="mt-4">
                            <ShortcutsPanel />
                          </div>
                        </>
                      }
                      notify={notify}
                      onEmbeddedSessionChange={(connected) => {
                        setEmbeddedConnections((current) =>
                          current[serial] === connected
                            ? current
                            : { ...current, [serial]: connected },
                        )
                      }}
                      embeddedSessionCommand={embeddedSessionCommands[serial]}
                      onRequestEmbeddedSession={(action) =>
                        requestEmbeddedSession(action, serial)
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
          {activeWorkspaceTool && activeWorkspaceTool !== 'file-explorer' ? (
            <WorkspaceToolSurface tool={activeWorkspaceTool}>
              {activeWorkspaceTool === 'compare' ? (
                <CompareWorkspace
                  sessions={compareSessions.sessions}
                  history={screenshot.history}
                  onSetReference={compareSessions.setReference}
                  onDeleteSession={compareSessions.deleteSession}
                  onUpdateIgnoreSettings={compareSessions.updateIgnoreSettings}
                  onSaveBaseline={compareSessions.saveBaseline}
                  onClearBaseline={compareSessions.clearBaseline}
                  onRecapture={async (sessionId, entry) => {
                    const result = await screenshot.capture(entry.deviceSerial)
                    if (!result.success) {
                      notify('Recapture failed', result.error || 'Unknown error', 'error')
                      return
                    }
                    compareSessions.replaceScreenshot(
                      sessionId,
                      entry.id,
                      screenshotHistoryEntryFromResult(result, entry.deviceName),
                    )
                  }}
                  onOpenDevice={(serial) => {
                    setActiveDevice(serial)
                    setIsDeviceStatusOpen(true)
                  }}
                  onOpenLogcat={(serial) => {
                    setActiveDevice(serial)
                    selectWorkspaceTool('logcat')
                  }}
                />
              ) : activeIosUdid || activeCompanionWorkspaceId ? (
                viewOnlyToolUnavailable
              ) : activeWorkspaceTool === 'test-runner' ? (
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
                    registeredDevices={registeredDevices}
                    activeDevice={activeDevice}
                    runningDevices={runningDevices}
                    customPath={config.scrcpyPath}
                    isRefreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    onAddDevice={() => setIsPairingOpen(true)}
                    onSelectDevice={setActiveDevice}
                    selectedDeviceIds={selectedDeviceIds}
                    onToggleDeviceSelection={toggleDeviceSelection}
                    onSelectAllDevices={selectAllDevices}
                    onClearDeviceSelection={clearDeviceSelection}
                    batchActions={
                      <DevicesBatchActions
                        selectedCount={selectedDeviceIds.size}
                        onlineCount={selectedOnlineDeviceIds.length}
                        busy={deviceBatchBusy}
                        onOpenWorkspace={openSelectedDeviceWorkspace}
                        onOpenBatchTools={openSelectedDeviceBatchTools}
                        onHome={() => void runSelectedDeviceAction('home')}
                        onBack={() => void runSelectedDeviceAction('back')}
                        onPower={() => void runSelectedDeviceAction('power')}
                        onVolumeUp={() => void runSelectedDeviceAction('volume_up')}
                        onVolumeDown={() => void runSelectedDeviceAction('volume_down')}
                        onMute={() => void runSelectedDeviceAction('mute')}
                        onReboot={confirmSelectedDeviceReboot}
                        onClear={clearDeviceSelection}
                      />
                    }
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
                    companionDevices={companion.devices}
                    companionScreenState={companion.screenState}
                    onViewCompanion={openCompanionWorkspace}
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
                        <div className="h-72 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
                          {logPanel}
                        </div>
                      </div>
                    }
                  />
                }
                screenshots={
                  <ScreenshotsPage
                    history={screenshot.history}
                    screenshotDir={screenshot.screenshotDir}
                    canCapture={Boolean(selectedScreenshotSource)}
                    isCapturing={captureBusy}
                    captureSource={{
                      options: screenshotCaptureSources,
                      selectedId: selectedScreenshotSourceId,
                      onChange: setSelectedScreenshotSourceId,
                    }}
                    onCapture={handleScreenshotPageCapture}
                    onCaptureAll={() => void handleCaptureAllSelected()}
                    captureAllCount={selectedOnlineDeviceIds.length}
                    onCompareSelected={(entries) => {
                      const session = compareSessions.createSession(entries)
                      if (session) selectWorkspaceTool('compare')
                    }}
                    onCaptureScroll={
                      selectedScreenshotSource?.kind === 'android-adb'
                        ? () => void autoCapture.start()
                        : undefined
                    }
                    autoCapture={
                      selectedScreenshotSource?.kind === 'android-adb'
                        ? {
                            activeDevice,
                            screenshotDir: screenshot.screenshotDir,
                            canStart:
                              Boolean(activeDevice) && !screenshot.isCapturing,
                            isActive: autoCapture.isActive,
                            session: autoCapture.session,
                            frames: autoCapture.frames,
                            lastEvent: autoCapture.lastEvent,
                            error: autoCapture.error,
                            onStart: async (captureConfig) => {
                              if (
                                !window.confirm(t('autoCapture.confirmStart'))
                              ) {
                                return
                              }
                              await autoCapture.start(captureConfig)
                            },
                            onCapturePreview: async () => {
                              if (!activeDevice)
                                throw new Error('No device selected')
                              return capturePreviewFrame(
                                activeDevice,
                                config.scrcpyPath,
                              )
                            },
                            onPause: autoCapture.pause,
                            onResume: autoCapture.resume,
                            onStop: autoCapture.stop,
                            onCancel: autoCapture.cancel,
                            onChangeDirectory: handleChangeScreenshotDir,
                            onOpenImage: (path) =>
                              handleScreenshotAction(
                                screenshot.openImage,
                                path,
                              ),
                            onOpenFolder: (path) =>
                              handleScreenshotAction(
                                screenshot.openFolder,
                                path,
                              ),
                            onCopyImage: (path) =>
                              handleScreenshotAction(
                                screenshot.copyToClipboard,
                                path,
                              ),
                          }
                        : undefined
                    }
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
                        notify(
                          t('screenshot.actionFailedTitle'),
                          String(error),
                          'error',
                        )
                      }
                    }}
                    onDeleteEntry={handleScreenshotDelete}
                    onDeleteEntries={async (ids, deleteFiles) => {
                      const result = await screenshot.deleteEntries(
                        ids,
                        deleteFiles,
                      )
                      if (result.failures.length > 0) {
                        notify(
                          t('screenshot.actionFailedTitle'),
                          t('screenshot.batchDeletePartialMessage', {
                            failed: result.failures.length,
                          }),
                          'warning',
                        )
                      } else if (deleteFiles) {
                        notify(
                          t('screenshot.batchDeleteSuccessTitle'),
                          t('screenshot.batchDeleteSuccessMessage', {
                            count: result.succeededIds.length,
                          }),
                          'success',
                        )
                      }
                      return result
                    }}
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
                    onOpenRecording={(path) =>
                      void recordingLibrary.openRecording(path)
                    }
                    onRevealRecording={(path) =>
                      void recordingLibrary.revealRecording(path)
                    }
                    onRemoveEntry={(id, deleteFile) =>
                      void recordingLibrary.removeEntry(id, deleteFile)
                    }
                    onClearHistory={recordingLibrary.clearHistory}
                  />
                }
                fileExplorer={
                  <FileExplorerPage
                    activeDevice={activeAndroidWorkspaceDevice}
                    customPath={config.scrcpyPath}
                    manager={
                      activeIosUdid || activeCompanionWorkspaceId ? (
                        viewOnlyToolUnavailable
                      ) : (
                        <FileManager
                          embedded
                          isOpen={false}
                          onClose={() => undefined}
                          activeDevice={activeDevice}
                          customPath={config.scrcpyPath}
                          defaultDownloadDir={screenshot.screenshotDir}
                          confirmAction={confirmAction}
                          notify={notify}
                        />
                      )
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
                    onInstallMultiple={openMultiDeviceApkInstall}
                    onOpenLogcat={openPackageLogcat}
                    onOpenShell={openPackageShell}
                    onPullApk={pullPackageApk}
                  />
                }
                apkToolkit={
                  <LocalApkToolkitPage
                    onInstallCurrent={installLocalApkOnCurrent}
                    onInstallSelected={installLocalApkOnSelected}
                    onExtractContents={(path) => extractLocalApkContents(path)}
                  />
                }
                simulators={
                  <SimulatorsPage
                    notify={notify}
                    customPath={config.scrcpyPath}
                    screenshotDir={screenshot.screenshotDir}
                    androidDevices={physicalAndroidDevices}
                    androidLabels={deviceWorkspaceLabels}
                    iosDevices={ios.devices}
                    onRefreshAndroid={refreshDevices}
                    onRefreshIos={ios.refreshDevices}
                    onOpenAndroid={openDeviceWorkspace}
                    onOpenIos={openIosWorkspace}
                    onIosFrame={handleIosFrame}
                    onScreenshotCaptured={(result, device) =>
                      screenshot.recordCaptureResult(result, device.name)
                    }
                  />
                }
                logcatViewer={
                  <LogcatViewerPage
                    activeDevice={activeAndroidWorkspaceDevice}
                    customPath={config.scrcpyPath}
                    notify={notify}
                    initialTagFilter={appToolPackage}
                  />
                }
                performance={
                  <PerformancePage
                    connected={
                      !activeIosUdid &&
                      !activeCompanionWorkspaceId &&
                      sessionRunning
                    }
                    bitrateMbps={config.bitrate}
                    adaptiveEnabled={
                      config.qualityMode === 'adaptive' ||
                      config.qualityMode === 'quality' ||
                      config.qualityMode === 'balanced'
                    }
                    onApplySaferProfile={(profile) => {
                      const nextConfig = applyQualityMode({
                        ...config,
                        qualityMode: profile,
                      })
                      setConfig(nextConfig)
                      if (activeDevice)
                        persistScrcpyLaunchConfig(localStorage, {
                          ...nextConfig,
                          device: activeDevice,
                        })
                      if (sessionRunning && activeDevice) {
                        const serial = activeDevice
                        if (adaptiveRestartTimerRef.current !== null) {
                          window.clearTimeout(adaptiveRestartTimerRef.current)
                        }
                        void stopScrcpy(serial).then(() => {
                          adaptiveRestartTimerRef.current = window.setTimeout(
                            () => {
                              adaptiveRestartTimerRef.current = null
                              if (latestActiveDeviceRef.current === serial) {
                                void runScrcpy(nextConfig)
                              }
                            },
                            600,
                          )
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
                    availableDeviceIds={devices}
                    selectedDeviceIds={selectedDeviceIds}
                    customPath={config.scrcpyPath}
                    outputDir={screenshot.screenshotDir}
                    notify={notify}
                  />
                }
                scriptManager={
                  <ScriptManagerPage
                    activeDevice={activeAndroidWorkspaceDevice}
                    availableDeviceIds={devices}
                    selectedDeviceIds={selectedDeviceIds}
                    customPath={config.scrcpyPath}
                    outputDir={screenshot.screenshotDir}
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
                        <h2 className="text-sm font-semibold text-[var(--text-base)]">
                          Mobile Device Studio
                        </h2>
                        <p className="mt-2 text-[10px] text-[var(--text-subtle)]">
                          Version {appVersion}
                        </p>
                        <p className="mt-4 text-[10px] leading-relaxed text-[var(--text-muted)]">
                          Built with scrcpy, Tauri, React, and Lucide. Existing
                          application links and setup help remain available from
                          the top bar.
                        </p>
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
      <CommandPalette
        commands={studioCommands}
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
      />

      {isProductToolingOpen && (
        <div className="fixed inset-0 z-[470] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setIsProductToolingOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Product tooling" className="flex h-[min(760px,92vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-zinc-950 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Product Tooling</h2>
                <p className="text-[9px] text-zinc-500">Recovery, workspace presets, activity and diagnostics</p>
              </div>
              <button type="button" onClick={() => setIsProductToolingOpen(false)} aria-label="Close product tooling" className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"><X size={15} /></button>
            </header>
            <ProductToolingPanel
              devices={registeredDevices.map((device) => ({
                deviceId: device.serial,
                adbState: device.adbState,
                status: device.health,
                recovery: device.serial === activeDevice ? activeRecovery : undefined,
              }))}
              selectedDeviceId={activeDevice || undefined}
              workspaceSnapshot={currentWorkspaceSnapshot()}
              activity={activity.events}
              appVersion={appVersion}
              onApplyWorkspacePreset={applyWorkspacePreset}
              onRecoveryAction={handleProductRecoveryAction}
              onExportBundle={exportProductDiagnostic}
            />
          </section>
        </div>
      )}

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
        onInstallMultiple={openMultiDeviceApkInstall}
        onOpenLogcat={openPackageLogcat}
        onOpenShell={openPackageShell}
        onPullApk={pullPackageApk}
      />

      <LogcatViewer
        isOpen={isLogcatOpen}
        onClose={() => setIsLogcatOpen(false)}
        activeDevice={activeDevice}
        customPath={config.scrcpyPath}
        notify={notify}
        initialTagFilter={appToolPackage}
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
        onClose={closeWorkspaceModal}
        devices={workspaceDevices}
        runningDevices={runningDevices}
        baseConfig={config}
        customPath={config.scrcpyPath}
        outputDir={screenshot.screenshotDir}
        notify={notify}
        iosDevices={ios.devices}
        iosReady={ios.support.supported && ios.support.found}
        launchDevice={runScrcpy}
        confirmAction={confirmAction}
      />

      <EmbeddedDeviceWorkspace
        isOpen={workspaceModal === 'embedded'}
        onClose={closeWorkspaceModal}
        devices={workspaceDevices}
        runningDevices={runningDevices}
        activeDevice={activeDevice}
        customPath={config.scrcpyPath}
        outputDir={screenshot.screenshotDir}
        notify={notify}
        companion={{
          available:
            companion.devices[0]?.transport === 'lan-tcp' &&
            companion.devices[0]?.capabilities.includes('start_screen_share'),
          frame: companion.screenFrame,
          screenState: companion.screenState,
          width: companion.screenStatus?.width,
          height: companion.screenStatus?.height,
          startScreen: companion.startScreen,
          stopScreen: companion.stopScreen,
        }}
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
