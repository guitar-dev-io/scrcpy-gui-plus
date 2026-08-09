import type { ReactNode } from 'react'

const panel =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

export type BottomWorkspaceTab = 'logcat' | 'shell' | 'events' | 'test-runner'

interface BottomWorkspacePanelProps {
  tabs: ReadonlyArray<{ id: BottomWorkspaceTab; label: string }>
  activeTab: BottomWorkspaceTab
  onSelectTab: (tab: BottomWorkspaceTab) => void
  children: ReactNode
}

export function BottomWorkspacePanel({
  tabs,
  activeTab,
  onSelectTab,
  children,
}: BottomWorkspacePanelProps) {
  return (
    <section className={`${panel} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="flex h-10 shrink-0 items-end gap-6 border-b border-[var(--border-subtle)] px-4">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelectTab(id)}
            className={`h-full border-b-2 text-[10px] font-semibold uppercase tracking-wide ${focusRing} ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-muted)]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  )
}

interface RightWorkspacePanelProps {
  title: string
  status: string
  children: ReactNode
}

export function RightWorkspacePanel({
  title,
  status,
  children,
}: RightWorkspacePanelProps) {
  return (
    <section className={`${panel} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-base)]">
          {title}
        </h2>
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-medium text-emerald-400">
          {status}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
