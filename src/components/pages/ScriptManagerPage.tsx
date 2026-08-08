import { Braces } from 'lucide-react'
import CustomCommand from '../custom-command'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface ScriptManagerPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

export default function ScriptManagerPage({
  activeDevice,
  customPath,
  notify,
}: ScriptManagerPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Braces size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">Script Manager</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              Save and run custom adb command presets against the active device.
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Custom commands" className="mt-5 min-h-0 flex-1">
        <CustomCommand
          embedded
          isOpen={false}
          onClose={() => {}}
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
        />
      </section>
    </div>
  )
}
