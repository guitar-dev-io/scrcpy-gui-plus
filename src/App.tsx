import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import Sidebar from './components/Sidebar'
import ControlPanel from './components/ControlPanel'
import LogPanel from './components/LogPanel'
import Header from './components/Header'
import SessionBehavior from './components/SessionBehavior'
import ShortcutsPanel from './components/ShortcutsPanel'
import Footer from './components/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import OnboardingModal from './components/OnboardingModal'
import ThemedModal from './components/ThemedModal'
import DeviceControlToolbar from './components/device-control-toolbar'
import ScreenshotManager from './components/screenshot-manager'
import LivePreview from './components/live-preview'
import EmbeddedMirror from './components/embedded-mirror'
import MirrorStage from './components/mirror-stage'
import BugReportModal from './components/bug-report'
import AppManager from './components/app-manager'
import LogcatViewer from './components/logcat-viewer'
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
import IosMirrorModal from './components/ios-mirror'
import WidgetLayout from './components/widget-layout'
import KeymapController from './components/keymap-controller'
import { useScrcpy } from './hooks/useScrcpy'
import { useScreenshot } from './hooks/useScreenshot'
import { useLivePreview } from './hooks/useLivePreview'
import { useEmbeddedMirror } from './hooks/useEmbeddedMirror'
import { useIosMirror, type IosDeviceInfo } from './hooks/useIosMirror'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from './utils/tauriEnv'
import { useI18n } from './i18n'

function App() {
  const { t } = useI18n()
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
    isOnboardingOpen,
    setIsOnboardingOpen,
    completeOnboarding,
  } = useScrcpy()

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

  const livePreview = useLivePreview({
    activeDevice,
    customPath: config.scrcpyPath,
  })

  const embeddedMirror = useEmbeddedMirror()
  const [isMirrorStageOpen, setIsMirrorStageOpen] = useState(false)

  const ios = useIosMirror(config.scrcpyPath)
  const [iosMirrorDevice, setIosMirrorDevice] = useState<IosDeviceInfo | null>(
    null,
  )

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
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [isEmbeddedWorkspaceOpen, setIsEmbeddedWorkspaceOpen] = useState(false)
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

  const handleScreenshotCapture = async () => {
    if (!activeDevice) {
      showAlert(
        t('alerts.noDeviceSelectedTitle'),
        t('alerts.noDeviceSelectedMessage'),
        'warning',
      )
      return
    }
    const res = await screenshot.capture(activeDevice)
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

        const { invoke } = await import('@tauri-apps/api/core')
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
          const { invoke } = await import('@tauri-apps/api/core')
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
      const { invoke } = await import('@tauri-apps/api/core')
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
        const { invoke } = await import('@tauri-apps/api/core')
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

  return (
    <ErrorBoundary>
      <div
        className="min-h-screen font-sans selection:bg-primary selection:text-on-primary overflow-hidden flex flex-col transition-opacity duration-1000 ease-in-out"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-base)',
          opacity: 0,
          animation: 'fadeIn 0.8s ease-out forwards',
        }}
      >
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div className="fixed inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none z-0"></div>
        <div className="fixed top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/30 via-transparent to-transparent pointer-events-none z-0"></div>

        <div className="relative z-10 flex flex-col h-screen transition-all duration-700">
          <Header
            onThemeChange={setTheme}
            currentTheme={theme}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            binaryStatus={scrcpyStatus}
            onDownload={downloadScrcpy}
            onSetPath={handleSetPath}
            onResetPath={handleResetPath}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            version={appVersion}
          />

          <div className="flex-1 overflow-y-auto flex flex-col pt-6 custom-scrollbar">
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 px-6 pb-6">
              <div className="lg:col-span-3 flex flex-col">
                <div className="transition-all duration-700">
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
                    onOpenWorkspace={() => setIsWorkspaceOpen(true)}
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
                    onIosMirror={(d) => setIosMirrorDevice(d)}
                  />
                </div>
              </div>

              <div className="lg:col-span-6 flex flex-col gap-6 relative z-20">
                <div className="relative z-30">
                  <ControlPanel
                    config={config}
                    setConfig={setConfig}
                    onStart={handleStart}
                    onStop={handleStop}
                    isRunning={sessionRunning}
                    detectedCameras={detectedCameras}
                    renderDriverSupport={renderDriverSupport}
                    onListOptions={(arg) => {
                      if (activeDevice) {
                        listScrcpyOptions(activeDevice, arg)
                      }
                    }}
                  />
                </div>
                <div className="relative z-20">
                  <DeviceControlToolbar
                    activeDevice={activeDevice}
                    customPath={config.scrcpyPath}
                    isRunning={sessionRunning}
                    recordingOutputDir={screenshot.screenshotDir}
                    fullscreenActive={!!config.fullscreen}
                    onToggleFullscreen={() =>
                      setConfig((prev) => ({
                        ...prev,
                        fullscreen: !prev.fullscreen,
                      }))
                    }
                    onScreenshot={handleScreenshotCapture}
                    isCapturing={screenshot.isCapturing}
                    onOpenBugReport={() => setIsBugReportOpen(true)}
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
                    onOpenEmbeddedWorkspace={() =>
                      setIsEmbeddedWorkspaceOpen(true)
                    }
                    notify={notify}
                  />
                </div>
                <div className="relative z-10">
                  <EmbeddedMirror
                    enabled={embeddedMirror.embedEnabled}
                    onToggle={embeddedMirror.setEmbedEnabled}
                    isRunning={sessionRunning}
                    dockRef={embeddedMirror.dockRef}
                    onRedock={handleRedock}
                    activeDevice={activeDevice}
                    customPath={config.scrcpyPath}
                    onScreenshot={handleScreenshotCapture}
                    isCapturing={screenshot.isCapturing}
                    notify={notify}
                  />
                </div>
                <div className="relative z-10">
                  <LivePreview
                    isPreviewing={livePreview.isPreviewing}
                    frameSrc={livePreview.frameSrc}
                    error={livePreview.error}
                    isLoading={livePreview.isLoading}
                    fps={livePreview.fps}
                    fpsOptions={livePreview.fpsOptions}
                    canPreview={livePreview.canPreview}
                    onToggle={livePreview.toggle}
                    onSetFps={livePreview.setFps}
                  />
                </div>
                <div className="relative z-10">
                  <LogPanel
                    logs={logs}
                    onClear={clearLogs}
                    onAddLog={(msg) =>
                      setLogs((prev: string[]) => [...prev.slice(-100), msg])
                    }
                    onRunCommand={runTerminalCommand}
                  />
                </div>
              </div>

              <div className="lg:col-span-3 flex flex-col gap-6">
                <SessionBehavior config={config} setConfig={setConfig} />
                <ScreenshotManager
                  history={screenshot.history}
                  screenshotDir={screenshot.screenshotDir}
                  isCapturing={screenshot.isCapturing}
                  canCapture={!!activeDevice}
                  shortcutLabel={
                    navigator.platform.toLowerCase().includes('mac')
                      ? 'Cmd+Shift+S'
                      : 'Ctrl+Shift+S'
                  }
                  onCapture={handleScreenshotCapture}
                  onChangeDirectory={handleChangeScreenshotDir}
                  onOpenImage={(p) =>
                    handleScreenshotAction(screenshot.openImage, p)
                  }
                  onOpenFolder={(p) =>
                    handleScreenshotAction(screenshot.openFolder, p)
                  }
                  onCopyImage={async (p) => {
                    try {
                      await screenshot.copyToClipboard(p)
                      notify(
                        t('screenshot.copiedTitle'),
                        t('screenshot.copiedMessage'),
                        'success',
                      )
                    } catch (e) {
                      notify(
                        t('screenshot.actionFailedTitle'),
                        String(e),
                        'error',
                      )
                    }
                  }}
                  onDeleteEntry={(id) => screenshot.deleteEntry(id)}
                  onClearHistory={screenshot.clearHistory}
                />
                <ShortcutsPanel />
              </div>
            </div>

            <Footer version={appVersion} />
          </div>
        </div>

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
          isOpen={isWorkspaceOpen}
          onClose={() => setIsWorkspaceOpen(false)}
          devices={devices}
          runningDevices={runningDevices}
          baseConfig={config}
          customPath={config.scrcpyPath}
          outputDir={screenshot.screenshotDir}
          notify={notify}
          iosDevices={ios.devices}
          iosReady={ios.support.supported && ios.support.found}
        />

        <EmbeddedDeviceWorkspace
          isOpen={isEmbeddedWorkspaceOpen}
          onClose={() => setIsEmbeddedWorkspaceOpen(false)}
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

        <IosMirrorModal
          isOpen={!!iosMirrorDevice}
          onClose={() => setIosMirrorDevice(null)}
          device={iosMirrorDevice}
          customPath={config.scrcpyPath}
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
      </div>
    </ErrorBoundary>
  )
}

export default App
