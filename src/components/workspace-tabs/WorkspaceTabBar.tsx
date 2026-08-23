import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  Columns3,
  FileText,
  LayoutGrid,
  ListChecks,
  Plus,
  ScrollText,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react'
import { classNames } from '../ui/classNames'
import { useShellUi } from '../../contexts/ShellUiContext'
import type { WorkspaceToolTab } from '../../types/workspace'

interface WorkspaceTabBarProps {
  /** Device workspaces that should remain open, independently of native scrcpy windows. */
  deviceWorkspaces?: string[]
  deviceLabels?: Readonly<Record<string, string>>
  deviceKinds?: Readonly<Record<string, 'android' | 'ios' | 'companion'>>
  runningDevices: string[]
  activeDevice: string
  onSelectDevice: (serial: string) => void
  onCloseDevice: (serial: string) => void
  onAddDevice: () => void
  toolbar?: ReactNode
  multiDeviceView?: boolean
  onToggleMultiDeviceView?: () => void
}

const toolTabs: ReadonlyArray<{
  id: WorkspaceToolTab
  label: string
  icon: typeof ListChecks
}> = [
  { id: 'test-runner', label: 'Test Run', icon: ListChecks },
  { id: 'logcat', label: 'Logcat', icon: ScrollText },
  { id: 'shell', label: 'Shell', icon: Terminal },
  { id: 'file-explorer', label: 'File Explorer', icon: FileText },
  { id: 'compare', label: 'Compare', icon: Columns3 },
]

export default function WorkspaceTabBar({
  deviceWorkspaces,
  deviceLabels,
  deviceKinds,
  runningDevices,
  activeDevice,
  onSelectDevice,
  onCloseDevice,
  onAddDevice,
  toolbar,
  multiDeviceView = false,
  onToggleMultiDeviceView,
}: WorkspaceTabBarProps) {
  const {
    openWorkspaceTools: openToolTabs,
    activeWorkspaceTool: activeToolTab,
    selectWorkspaceTool: onSelectToolTab,
    closeWorkspaceTool: onCloseToolTab,
  } = useShellUi()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Embedded sessions do not appear in useScrcpy.runningDevices, so their
  // workspace lifecycle is supplied separately by the shell owner.
  const devices = Array.from(new Set(deviceWorkspaces ?? runningDevices))
  const visibleTools = toolTabs.filter(({ id }) => openToolTabs.includes(id))

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [menuOpen])

  const selectTool = (tab: WorkspaceToolTab) => {
    onSelectToolTab(tab)
    setMenuOpen(false)
  }

  return (
    <div
      className="relative z-[var(--z-topbar)] flex h-[60px] shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMenuOpen(false)
      }}
    >
      <div
        role="tablist"
        aria-label="Open workspaces"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {devices.map((serial) => {
          const active = activeToolTab === undefined && serial === activeDevice
          const label = deviceLabels?.[serial] || serial
          const kind = deviceKinds?.[serial] ?? 'android'
          const closeLabel =
            kind === 'ios'
              ? `Close iOS workspace for ${serial}`
              : kind === 'companion'
                ? `Close Companion workspace for ${serial}`
                : `Stop session on ${serial}`
          const closeTitle =
            kind === 'ios'
              ? 'Close iOS workspace'
              : kind === 'companion'
                ? 'Close Companion workspace'
                : 'Stop session'
          return (
            <div
              key={serial}
              className={classNames(
                'group flex h-9 shrink-0 items-center rounded-md border text-[11px] font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-[var(--text-base)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-base)] hover:text-[var(--text-base)]',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectDevice(serial)}
                className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-2 focus:outline-none"
                title={`${label} · ${serial}`}
              >
                <Smartphone size={12} className="shrink-0" />
                <span className="max-w-35 truncate">{label}</span>
                {kind !== 'android' && (
                  <span className="rounded bg-white/7 px-1 py-0.5 text-[7px] font-semibold uppercase text-[var(--text-subtle)]">
                    {kind === 'ios' ? 'iOS' : 'Companion'}
                  </span>
                )}
                {runningDevices.includes(serial) && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                    aria-label="Session running"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => onCloseDevice(serial)}
                aria-label={closeLabel}
                title={closeTitle}
                className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-subtle)] opacity-60 hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] group-hover:opacity-100 focus:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}

        {visibleTools.map(({ id, label, icon: Icon }) => {
          const active = activeToolTab === id
          return (
            <div
              key={id}
              className={classNames(
                'group flex h-9 shrink-0 items-center rounded-md border text-[10px] font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-[var(--text-base)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--border-base)] hover:text-[var(--text-base)]',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTool(id)}
                className="flex h-full items-center gap-1.5 pl-2.5 pr-2 focus:outline-none"
              >
                <Icon size={11} />
                {label}
              </button>
              <button
                type="button"
                onClick={() => onCloseToolTab(id)}
                aria-label={`Close ${label} workspace`}
                className="mr-1.5 flex h-5 w-5 items-center justify-center rounded text-[var(--text-subtle)] opacity-60 hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] group-hover:opacity-100 focus:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}

        {devices.length === 0 && visibleTools.length === 0 && (
          <span className="px-2 text-[10px] text-[var(--text-subtle)]">
            No open workspaces
          </span>
        )}
      </div>
      {devices.length > 1 && onToggleMultiDeviceView && (
        <button
          type="button"
          onClick={onToggleMultiDeviceView}
          aria-label={
            multiDeviceView ? 'Show focused device' : 'Show all devices'
          }
          aria-pressed={multiDeviceView}
          title={multiDeviceView ? 'Focused device view' : 'Multi-device grid'}
          className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${multiDeviceView ? 'bg-primary/15 text-primary' : 'text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'}`}
        >
          <LayoutGrid size={13} />
        </button>
      )}
      <div ref={menuRef} className="relative ml-1 shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Open workspace"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Open workspace"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]"
        >
          <Plus size={13} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            aria-label="Workspace types"
            className="absolute right-0 top-9 z-[calc(var(--z-topbar)+1)] w-48 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-[0_14px_36px_rgba(0,0,0,.32)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddDevice()
                setMenuOpen(false)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]"
            >
              <Smartphone size={12} />
              Add device session
            </button>
            <div className="my-1 border-t border-[var(--border-subtle)]" />
            {toolTabs.map(({ id, label, icon: Icon }) => {
              const open = openToolTabs.includes(id)
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  aria-label={`${label}${open ? ' (open)' : ''}`}
                  onClick={() => selectTool(id)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]"
                >
                  <Icon size={12} />
                  <span className="flex-1">{label}</span>
                  {open && <Check size={11} aria-label="Open" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {toolbar && <div className="ml-1 shrink-0">{toolbar}</div>}
    </div>
  )
}
