import { useEffect, useState } from 'react'
import { Braces, FilePlus2, Save, X } from 'lucide-react'

export type MaestroYamlEditorMode = 'new' | 'edit'

interface MaestroYamlEditorDialogProps {
  mode: MaestroYamlEditorMode
  initialName: string
  initialYaml: string
  onClose: () => void
  onApply: (name: string, yaml: string) => string | null
}

export default function MaestroYamlEditorDialog({
  mode,
  initialName,
  initialYaml,
  onClose,
  onApply,
}: MaestroYamlEditorDialogProps) {
  const [name, setName] = useState(initialName)
  const [yaml, setYaml] = useState(initialYaml)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        const validationError = onApply(name, yaml)
        setError(validationError ?? '')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [name, onApply, onClose, yaml])

  const apply = () => {
    const validationError = onApply(name, yaml)
    setError(validationError ?? '')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="maestro-yaml-editor-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        className="flex h-[min(760px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            {mode === 'new' ? <FilePlus2 size={16} /> : <Braces size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="maestro-yaml-editor-title" className="text-sm font-semibold text-[var(--text-base)]">
              {mode === 'new' ? 'New YAML Flow' : 'Edit YAML Flow'}
            </h2>
            <p className="mt-0.5 text-[9px] text-[var(--text-subtle)]">
              Apply converts the YAML into visual steps. Unsupported Maestro blocks are preserved as raw YAML.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close YAML editor" className="rounded-lg p-2 text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]">
            <X size={16} />
          </button>
        </header>

        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <label className="flex min-w-0 flex-1 items-center gap-3 text-[9px] font-semibold text-[var(--text-subtle)]">
            Flow name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Maestro flow"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
            />
          </label>
          <span className="hidden text-[8px] text-[var(--text-subtle)] sm:block">⌘/Ctrl + Enter to apply</span>
        </div>

        <div className="relative min-h-0 flex-1 bg-[#0b1220]">
          <textarea
            value={yaml}
            onChange={(event) => {
              setYaml(event.target.value)
              if (error) setError('')
            }}
            aria-label="Maestro YAML"
            spellCheck={false}
            className="custom-scrollbar h-full w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-6 text-slate-200 outline-none selection:bg-primary/30"
          />
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0 flex-1">
            {error ? (
              <p role="alert" className="line-clamp-2 text-[9px] text-red-300">{error}</p>
            ) : (
              <p className="text-[8px] text-[var(--text-subtle)]">Required: a valid appId, `---` separator, and at least one Maestro command.</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="h-8 rounded-lg border border-[var(--border-base)] px-4 text-[9px] font-semibold text-[var(--text-muted)] hover:bg-white/5">
            Cancel
          </button>
          <button type="button" onClick={apply} disabled={!name.trim() || !yaml.trim()} className="flex h-8 items-center gap-2 rounded-lg bg-primary px-4 text-[9px] font-bold text-on-primary disabled:opacity-40">
            <Save size={12} /> Apply to Steps
          </button>
        </footer>
      </section>
    </div>
  )
}
