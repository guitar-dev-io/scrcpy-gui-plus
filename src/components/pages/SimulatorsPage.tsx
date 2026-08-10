import { MonitorSmartphone } from 'lucide-react'
import SimulatorsPanel from '../simulators'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface SimulatorsPageProps {
  notify: ToolbarNotifier
}

export default function SimulatorsPage({ notify }: SimulatorsPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <MonitorSmartphone size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">Simulators</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              Boot, control, and inspect iOS Simulators and Android Emulators via SimDeck.
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Simulators and emulators" className="mt-5 min-h-0 flex-1">
        <SimulatorsPanel embedded isOpen={false} onClose={() => {}} notify={notify} />
      </section>
    </div>
  )
}
