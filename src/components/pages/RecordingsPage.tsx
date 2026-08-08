import { useState, type ReactNode } from 'react'
import {
  FolderOpen,
  MonitorPlay,
  Settings2,
  Video,
  X,
} from 'lucide-react'

export interface RecordingsPageProps {
  /** Existing recording controls. This page never creates or replaces commands. */
  deviceControls: ReactNode
  activeDevice: string
  /** Whether the selected device currently has a live scrcpy session. */
  isRunning: boolean
  recordPath?: string
  onChangeRecordPath: () => void
  onOpenRecordPath?: () => void
  onOpenDashboard?: () => void
}

export default function RecordingsPage({
  deviceControls,
  activeDevice,
  isRunning,
  recordPath,
  onChangeRecordPath,
  onOpenRecordPath,
  onOpenDashboard,
}: RecordingsPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-base)]">Recordings</h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
            Screen recordings from the selected Android device
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2.5 py-1.5 text-[9px] font-medium ${
              activeDevice
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-[var(--border-subtle)] text-[var(--text-subtle)]'
            }`}
          >
            {activeDevice || 'No device selected'}
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary shadow-[0_8px_20px_rgba(var(--primary-rgb),.18)] transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <Settings2 size={13} /> Record Settings
          </button>
        </div>
      </header>

      <section
        aria-labelledby="recording-library-title"
        className="mt-5 min-h-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]"
      >
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-black/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Video size={13} className="text-primary" />
            <h2 id="recording-library-title" className="text-[10px] font-semibold text-[var(--text-muted)]">
              Recording Library
            </h2>
          </div>
          <span className="text-[9px] text-[var(--text-subtle)]">History is not persisted</span>
        </div>

        <div className="custom-scrollbar overflow-x-auto">
          <div className="grid min-w-[620px] grid-cols-[minmax(260px,1fr)_100px_110px_120px] border-b border-[var(--border-subtle)] px-4 py-3 text-[8px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
            <span>Name</span>
            <span>Duration</span>
            <span>Size</span>
            <span>Recorded</span>
          </div>
        </div>

        <div className="flex min-h-[310px] flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[.08] text-primary">
            <Video size={23} />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-[var(--text-base)]">No recording history available</h3>
          <p className="mt-2 max-w-md text-[10px] leading-relaxed text-[var(--text-subtle)]">
            The current recording service returns the saved file path when recording stops, but does not maintain a browsable history. Use the existing recording control to save a new file.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {onOpenDashboard && (
              <button
                type="button"
                onClick={onOpenDashboard}
                className="flex h-9 items-center gap-2 rounded-lg border border-primary/35 bg-primary/10 px-3 text-[10px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <MonitorPlay size={13} /> {isRunning ? 'Open active session' : 'Open Dashboard'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <Video size={13} /> Recording controls
            </button>
          </div>
        </div>
      </section>

      <aside className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-4">
        <div className="min-w-0">
          <p className="text-[8px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Record path</p>
          <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
            {recordPath || 'Default Videos folder'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpenRecordPath && (
            <button
              type="button"
              onClick={onOpenRecordPath}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <FolderOpen size={12} /> Open
            </button>
          )}
          <button
            type="button"
            onClick={onChangeRecordPath}
            className="h-8 rounded-lg border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            Change
          </button>
        </div>
      </aside>

      {settingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recording-settings-title"
          className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/55 backdrop-blur-sm"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <aside
            className="custom-scrollbar h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <Settings2 size={15} className="text-primary" />
                <div>
                  <h2 id="recording-settings-title" className="text-sm font-semibold text-[var(--text-base)]">Record Settings</h2>
                  <p className="mt-0.5 text-[9px] text-[var(--text-subtle)]">
                    {activeDevice ? `Controls for ${activeDevice}` : 'Select a device to begin'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close recording settings"
                className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[9px] text-[var(--text-subtle)]">Session</span>
                <span className={`text-[9px] font-medium ${isRunning ? 'text-emerald-400' : 'text-[var(--text-subtle)]'}`}>
                  {isRunning ? 'Running' : 'Not running'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[9px] text-[var(--text-subtle)]">Output</span>
                <span className="max-w-[70%] truncate text-right text-[9px] text-[var(--text-muted)]">
                  {recordPath || 'Default Videos folder'}
                </span>
              </div>
            </div>

            {deviceControls}
          </aside>
        </div>
      )}
    </div>
  )
}
