import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  appRouteFromHash,
  appRouteToHash,
  type AppRouteId,
} from '../navigation/appRoutes'
import {
  WORKSPACE_TOOL_TABS,
  type DashboardBottomTab,
  type WorkspaceToolTab,
} from '../types/workspace'

const OPEN_WORKSPACE_TOOLS_KEY = 'scrcpy-gui:open-workspace-tools'
const DEFAULT_WORKSPACE_TOOLS: WorkspaceToolTab[] = [
  'test-runner',
  'logcat',
  'shell',
]

interface NavigateOptions {
  preserveWorkspace?: boolean
}

interface ShellUiContextValue {
  activeRoute: AppRouteId
  navigate: (route: AppRouteId, options?: NavigateOptions) => void
  navigationCollapsed: boolean
  setNavigationCollapsed: (collapsed: boolean) => void
  toggleNavigation: () => void
  dashboardBottomTab: DashboardBottomTab
  selectDashboardBottomTab: (tab: DashboardBottomTab) => void
  openWorkspaceTools: WorkspaceToolTab[]
  activeWorkspaceTool?: WorkspaceToolTab
  selectWorkspaceTool: (tab: WorkspaceToolTab) => void
  closeWorkspaceTool: (tab: WorkspaceToolTab) => void
  activateDeviceWorkspace: () => void
}

const ShellUiContext = createContext<ShellUiContextValue | null>(null)

function readOpenWorkspaceTools(): WorkspaceToolTab[] {
  try {
    const raw = window.localStorage.getItem(OPEN_WORKSPACE_TOOLS_KEY)
    if (raw === null) return DEFAULT_WORKSPACE_TOOLS
    const stored: unknown = JSON.parse(raw)
    if (!Array.isArray(stored)) return []
    return Array.from(new Set(stored.filter((tab): tab is WorkspaceToolTab =>
      WORKSPACE_TOOL_TABS.includes(tab as WorkspaceToolTab),
    )))
  } catch {
    return []
  }
}

interface ShellUiProviderProps {
  children: ReactNode
  initialRoute?: AppRouteId
  initialNavigationCollapsed?: boolean
  initialOpenWorkspaceTools?: WorkspaceToolTab[]
}

export function ShellUiProvider({
  children,
  initialRoute,
  initialNavigationCollapsed = false,
  initialOpenWorkspaceTools,
}: ShellUiProviderProps) {
  const [activeRoute, setActiveRoute] = useState<AppRouteId>(() =>
    initialRoute ?? appRouteFromHash(window.location.hash),
  )
  const [navigationCollapsed, setNavigationCollapsed] = useState(
    initialNavigationCollapsed,
  )
  const [dashboardBottomTab, setDashboardBottomTab] =
    useState<DashboardBottomTab>('logcat')
  const [openWorkspaceTools, setOpenWorkspaceTools] = useState<WorkspaceToolTab[]>(() => {
    const stored = initialOpenWorkspaceTools ?? readOpenWorkspaceTools()
    return activeRoute === 'file-explorer' && !stored.includes('file-explorer')
      ? [...stored, 'file-explorer']
      : stored
  })
  const [activeWorkspaceTool, setActiveWorkspaceTool] = useState<
    WorkspaceToolTab | undefined
  >(() => activeRoute === 'file-explorer' ? 'file-explorer' : undefined)
  const preserveWorkspaceOnHashChangeRef = useRef(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        OPEN_WORKSPACE_TOOLS_KEY,
        JSON.stringify(openWorkspaceTools),
      )
    } catch {
      // Workspace tabs remain usable when browser storage is unavailable.
    }
  }, [openWorkspaceTools])

  useEffect(() => {
    const syncRoute = () => {
      const route = appRouteFromHash(window.location.hash)
      setActiveRoute(route)
      if (route === 'file-explorer') {
        setOpenWorkspaceTools((tabs) =>
          tabs.includes('file-explorer') ? tabs : [...tabs, 'file-explorer'],
        )
        setActiveWorkspaceTool('file-explorer')
      } else if (!preserveWorkspaceOnHashChangeRef.current) {
        setActiveWorkspaceTool(undefined)
      }
      preserveWorkspaceOnHashChangeRef.current = false
    }
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  const navigate = (route: AppRouteId, options: NavigateOptions = {}) => {
    const preserveWorkspace = options.preserveWorkspace ?? false
    preserveWorkspaceOnHashChangeRef.current = preserveWorkspace
    if (route === 'file-explorer') {
      setOpenWorkspaceTools((tabs) =>
        tabs.includes('file-explorer') ? tabs : [...tabs, 'file-explorer'],
      )
      setActiveWorkspaceTool('file-explorer')
    } else if (!preserveWorkspace) {
      setActiveWorkspaceTool(undefined)
    }
    const hash = appRouteToHash(route)
    if (window.location.hash === hash) {
      preserveWorkspaceOnHashChangeRef.current = false
      setActiveRoute(route)
      return
    }
    window.location.hash = hash
  }

  const selectWorkspaceTool = (tab: WorkspaceToolTab) => {
    setOpenWorkspaceTools((tabs) => tabs.includes(tab) ? tabs : [...tabs, tab])
    setActiveWorkspaceTool(tab)
    if (tab === 'file-explorer') {
      navigate('file-explorer', { preserveWorkspace: true })
      return
    }
    if (tab !== 'compare') setDashboardBottomTab(tab)
    navigate('dashboard', { preserveWorkspace: true })
  }

  const closeWorkspaceTool = (tab: WorkspaceToolTab) => {
    setOpenWorkspaceTools((tabs) => tabs.filter((candidate) => candidate !== tab))
    if (activeWorkspaceTool !== tab) return
    setActiveWorkspaceTool(undefined)
    navigate('dashboard', { preserveWorkspace: true })
  }

  const activateDeviceWorkspace = () => {
    setActiveWorkspaceTool(undefined)
    navigate('dashboard', { preserveWorkspace: true })
  }

  const selectDashboardBottomTab = (tab: DashboardBottomTab) => {
    setDashboardBottomTab(tab)
  }

  return (
    <ShellUiContext.Provider
      value={{
        activeRoute,
        navigate,
        navigationCollapsed,
        setNavigationCollapsed,
        toggleNavigation: () => setNavigationCollapsed((collapsed) => !collapsed),
        dashboardBottomTab,
        selectDashboardBottomTab,
        openWorkspaceTools,
        activeWorkspaceTool,
        selectWorkspaceTool,
        closeWorkspaceTool,
        activateDeviceWorkspace,
      }}
    >
      {children}
    </ShellUiContext.Provider>
  )
}

export function useShellUi() {
  const context = useContext(ShellUiContext)
  if (!context) {
    throw new Error('useShellUi must be used within ShellUiProvider')
  }
  return context
}
