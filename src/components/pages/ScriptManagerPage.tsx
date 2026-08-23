import { useEffect, useState } from 'react'
import { Braces } from 'lucide-react'
import CustomCommand from '../custom-command'
import AppTestPanel from '../script-manager/AppTestPanel'
import MaestroBuilder from '../maestro-builder/MaestroBuilder'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface ScriptManagerPageProps {
  activeDevice: string
  availableDeviceIds?: readonly string[]
  selectedDeviceIds?: ReadonlySet<string>
  customPath?: string
  outputDir?: string
  notify: ToolbarNotifier
}

type ScriptManagerTab = 'custom' | 'maestro' | 'smoke'

const TABS: Array<{ id: ScriptManagerTab; label: string }> = [
  { id: 'custom', label: 'Custom Commands' },
  { id: 'maestro', label: 'Maestro Builder' },
  { id: 'smoke', label: 'App Smoke' },
]

export default function ScriptManagerPage({
  activeDevice,
  availableDeviceIds = activeDevice ? [activeDevice] : [],
  selectedDeviceIds = new Set<string>(),
  customPath,
  outputDir,
  notify,
}: ScriptManagerPageProps) {
  const [packageName, setPackageName] = useState(() =>
    localStorage.getItem('scrcpy_script_manager_package') ?? '',
  )
  const [tab, setTab] = useState<ScriptManagerTab>('maestro')

  useEffect(() => {
    localStorage.setItem('scrcpy_script_manager_package', packageName)
  }, [packageName])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={`flex items-center border-b border-[var(--border-subtle)] ${tab === 'maestro' ? 'min-h-10 py-1.5' : 'min-h-[72px] py-4'}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`${tab === 'maestro' ? 'hidden' : 'flex'} h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary`}>
            <Braces size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className={tab === 'maestro' ? 'text-[9px] font-semibold text-[var(--text-subtle)]' : 'text-lg font-semibold text-[var(--text-base)]'}>Script Manager</h1>
            <p className={`mt-1 text-[10px] text-[var(--text-subtle)] ${tab === 'maestro' ? 'hidden' : ''}`}>
              Build ADB scripts around an app package and run a repeatable smoke test.
            </p>
          </div>
        </div>
        <div className="ml-auto flex h-8 shrink-0 gap-0.5 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] p-0.5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 text-[9px] font-semibold transition-colors ${tab === id ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'maestro' ? (
        <section aria-label="Maestro Builder" className="mt-3 min-h-0 flex-1">
          <MaestroBuilder
            activeDevice={activeDevice}
            availableDeviceIds={availableDeviceIds}
            selectedDeviceIds={selectedDeviceIds}
            customPath={customPath}
            packageName={packageName}
            outputDir={outputDir}
            notify={notify}
          />
        </section>
      ) : (
        <>
          <section aria-label="App test target" className="mt-5">
            <label className="flex items-center gap-3 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-3">
              <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
                App package
              </span>
              <input
                value={packageName}
                onChange={(event) => setPackageName(event.target.value.trim())}
                placeholder="com.example.app"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 py-2 font-mono text-[10px] text-[var(--text-base)] outline-none focus:border-primary/50"
              />
              <span className="hidden text-[9px] text-[var(--text-subtle)] md:block">
                {activeDevice || 'No ADB device selected'}
              </span>
            </label>
          </section>

          <section aria-label="ADB app scripts" className="mt-3 min-h-0 flex-1">
            {tab === 'custom' ? (
              <CustomCommand
                embedded
                isOpen={false}
                onClose={() => {}}
                activeDevice={activeDevice}
                packageName={packageName || undefined}
                customPath={customPath}
                notify={notify}
              />
            ) : (
              <AppTestPanel
                activeDevice={activeDevice}
                packageName={packageName}
                customPath={customPath}
                outputDir={outputDir}
                notify={notify}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}
