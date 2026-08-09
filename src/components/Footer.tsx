import {
  AppWindow,
  Coffee,
  Folder,
  Github,
  Image,
  LayoutDashboard,
  MonitorPlay,
  Settings,
  Smartphone,
  Video,
  Wifi,
  Youtube,
} from 'lucide-react'
import type { AppRouteId } from '../navigation/appRoutes'
import { useShellUi } from '../contexts/ShellUiContext'

interface FooterProps {
  version: string
}

const dockItems: Array<{
  route: AppRouteId
  label: string
  icon: typeof LayoutDashboard
}> = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { route: 'devices', label: 'Devices', icon: Smartphone },
  { route: 'sessions', label: 'Sessions', icon: MonitorPlay },
  { route: 'screenshots', label: 'Screenshots', icon: Image },
  { route: 'recordings', label: 'Recordings', icon: Video },
  { route: 'file-explorer', label: 'File Explorer', icon: Folder },
  { route: 'wireless-adb', label: 'Wireless ADB', icon: Wifi },
  { route: 'app-manager', label: 'App Manager', icon: AppWindow },
  { route: 'settings', label: 'Settings', icon: Settings },
]

export default function Footer({ version }: FooterProps) {
  const {
    activeRoute,
    navigate: onNavigate,
    navigationCollapsed,
    toggleNavigation: onToggleNavigation,
  } = useShellUi()
  return (
    <footer className="flex h-[60px] w-full min-w-0 items-center border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 lg:hidden">
      <div className={`hidden shrink-0 items-center border-r border-[var(--border-subtle)] text-[9px] text-[var(--text-subtle)] min-[1181px]:flex ${navigationCollapsed ? 'w-[72px] justify-center' : 'w-[284px]'}`}>
        <button type="button" onClick={onToggleNavigation} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]" aria-label={navigationCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <AppWindow size={13} /> {!navigationCollapsed && <span>Collapse · v{version}</span>}
        </button>
      </div>

      <nav aria-label="Dashboard dock" className="custom-scrollbar mx-auto flex h-full min-w-0 items-center justify-start gap-2 overflow-x-auto lg:justify-center lg:gap-5">
        {dockItems.map(({ route, label, icon: Icon }) => {
          const active = activeRoute === route
          return (
            <button
              key={route}
              type="button"
              onClick={() => onNavigate(route)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`group flex min-w-[58px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[9px] transition-colors ${active ? 'text-primary' : 'text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)]'}`}
            >
              <Icon size={18} className={active ? 'drop-shadow-[0_0_8px_rgba(var(--primary-rgb),.6)]' : ''} />
              <span className="hidden whitespace-nowrap md:block">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="hidden w-[180px] items-center justify-end gap-3 text-[var(--text-subtle)] xl:flex">
        <a href="https://github.com/kil0bit-kb" target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="hover:text-[var(--text-base)]"><Github size={13} /></a>
        <a href="https://www.youtube.com/@kilObit" target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="hover:text-[var(--text-base)]"><Youtube size={13} /></a>
        <a href="https://www.patreon.com/cw/KB_kilObit" target="_blank" rel="noopener noreferrer" aria-label="Support" className="hover:text-primary"><Coffee size={13} /></a>
      </div>
    </footer>
  )
}
