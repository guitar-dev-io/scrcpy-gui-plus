import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type { MaestroFlow } from '../../types/maestroBuilder'

type Variable = NonNullable<MaestroFlow['variables']>[number]

interface MaestroVariablesPanelProps {
  variables: Variable[]
  onChange: (variables: Variable[]) => void
}

export default function MaestroVariablesPanel({ variables, onChange }: MaestroVariablesPanelProps) {
  const [open, setOpen] = useState(true)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const addVariable = () => {
    const id = `variable-${Date.now().toString(36)}`
    onChange([...variables, { id, name: `variable${variables.length + 1}`, value: '' }])
  }
  const patchVariable = (id: string, patch: Partial<Variable>) => {
    onChange(variables.map((variable) => variable.id === id ? { ...variable, ...patch } : variable))
  }

  return (
    <div className="shrink-0 border-t border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex h-8 w-full items-center px-3 text-left text-[8px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:bg-white/5"
      >
        Variables ({variables.length})
        <span className="ml-auto text-[10px] text-[var(--text-subtle)]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="max-h-32 space-y-1 overflow-auto px-2 pb-2">
          {variables.map((variable) => {
            const showValue = !variable.sensitive || revealed.has(variable.id)
            return (
              <div key={variable.id} className="grid grid-cols-[minmax(55px,.7fr)_minmax(70px,1fr)_20px_20px] items-center gap-1 rounded border border-[var(--border-subtle)] bg-black/10 p-1">
                <input
                  aria-label="Variable name"
                  value={variable.name}
                  onChange={(event) => patchVariable(variable.id, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, '') })}
                  className="h-6 min-w-0 bg-transparent px-1 font-mono text-[8px] text-[var(--text-muted)] outline-none focus:text-primary"
                />
                <input
                  aria-label={`Value for ${variable.name}`}
                  type={showValue ? 'text' : 'password'}
                  value={variable.value}
                  placeholder={`\${${variable.name}}`}
                  onChange={(event) => patchVariable(variable.id, { value: event.target.value })}
                  className="h-6 min-w-0 rounded bg-[var(--bg-input)] px-1.5 text-[8px] text-[var(--text-muted)] outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="button"
                  title={variable.sensitive ? 'Show or hide sensitive value' : 'Mark as sensitive'}
                  aria-label={variable.sensitive ? 'Toggle sensitive variable visibility' : 'Mark variable as sensitive'}
                  onClick={() => {
                    if (!variable.sensitive) patchVariable(variable.id, { sensitive: true })
                    else setRevealed((current) => {
                      const next = new Set(current)
                      if (next.has(variable.id)) next.delete(variable.id)
                      else next.add(variable.id)
                      return next
                    })
                  }}
                  className="text-[var(--text-subtle)] hover:text-primary"
                >
                  {showValue ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
                <button type="button" title="Delete variable" aria-label={`Delete variable ${variable.name}`} onClick={() => onChange(variables.filter((item) => item.id !== variable.id))} className="text-[var(--text-subtle)] hover:text-red-400">
                  <Trash2 size={10} />
                </button>
              </div>
            )
          })}
          <button type="button" onClick={addVariable} className="flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-[var(--border-base)] text-[8px] font-semibold text-primary hover:bg-primary/10">
            <Plus size={9} /> Add Variable
          </button>
        </div>
      )}
    </div>
  )
}
