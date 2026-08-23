import { ScrollText } from 'lucide-react'
import LogcatViewer from '../logcat-viewer'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface LogcatViewerPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  initialTagFilter?: string
}

export default function LogcatViewerPage({
  activeDevice,
  customPath,
  notify,
  initialTagFilter,
}: LogcatViewerPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <ScrollText size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">Logcat Viewer</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              Stream, filter, and export logcat output from the active device.
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Logcat stream" className="mt-5 min-h-0 flex-1">
        <LogcatViewer
          embedded
          isOpen={false}
          onClose={() => {}}
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
          initialTagFilter={initialTagFilter}
        />
      </section>
    </div>
  )
}
