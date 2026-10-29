import type { ReactNode } from 'react'
import { Columns3, ListChecks, ScrollText, Terminal } from 'lucide-react'
import type { WorkspaceToolTab } from '../../types/workspace'
import { useI18n } from '../../i18n'

interface WorkspaceToolSurfaceProps {
  tool: Exclude<WorkspaceToolTab, 'file-explorer'>
  children: ReactNode
}

const metadata = {
  'test-runner': {
    icon: ListChecks,
  },
  logcat: {
    icon: ScrollText,
  },
  shell: {
    icon: Terminal,
  },
  compare: {
    icon: Columns3,
  },
} as const

export default function WorkspaceToolSurface({
  tool,
  children,
}: WorkspaceToolSurfaceProps) {
  const { t } = useI18n()
  const { icon: Icon } = metadata[tool]
  const title = t(`chrome.tools.${tool}.title`)
  const description = t(`chrome.tools.${tool}.description`)

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)] p-3">
      <header className="mb-3 flex min-h-14 shrink-0 items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Icon size={15} />
        </span>
        <span className="min-w-0">
          <h1 className="text-xs font-semibold text-[var(--text-base)]">{title}</h1>
          <p className="mt-0.5 truncate text-[9px] text-[var(--text-subtle)]">{description}</p>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {children}
      </div>
    </section>
  )
}
