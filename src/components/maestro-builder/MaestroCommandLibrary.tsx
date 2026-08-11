import { useMemo, useState, type RefObject } from 'react'
import { Plus, Search } from 'lucide-react'
import type {
  MaestroCommandCategory,
  MaestroCommandId,
} from '../../types/maestroBuilder'
import {
  MAESTRO_COMMON_COMMANDS,
  searchMaestroCommands,
} from '../../utils/maestroCommandRegistry'

const CATEGORY_LABELS: Record<MaestroCommandCategory, string> = {
  common: 'Common',
  interaction: 'Interaction',
  input: 'Input',
  assertion: 'Assertions',
  gesture: 'Gestures',
  appState: 'App & State',
  flowControl: 'Flow Control',
  device: 'Device',
  media: 'Media & Debug',
  custom: 'Custom',
}

const CATEGORY_ORDER: MaestroCommandCategory[] = [
  'interaction',
  'input',
  'assertion',
  'gesture',
  'appState',
  'device',
  'media',
  'flowControl',
]

interface MaestroCommandLibraryProps {
  onAddCommand: (commandId: MaestroCommandId) => void
  searchInputRef?: RefObject<HTMLInputElement | null>
}

export default function MaestroCommandLibrary({
  onAddCommand,
  searchInputRef,
}: MaestroCommandLibraryProps) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => searchMaestroCommands(query), [query])
  const grouped = useMemo(() => {
    const map = new Map<MaestroCommandCategory, typeof results>()
    for (const definition of results) {
      const list = map.get(definition.category) ?? []
      list.push(definition)
      map.set(definition.category, list)
    }
    return map
  }, [results])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--border-subtle)] p-2">
        <div className="relative">
          <Search
            size={11}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
          />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search actions..."
            aria-label="Search actions"
            className="h-7 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] pl-6 pr-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {!query && MAESTRO_COMMON_COMMANDS.length > 0 && (
          <div>
            <p className="mb-1 px-1 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
              Common
            </p>
            <div className="space-y-0.5">
              {MAESTRO_COMMON_COMMANDS.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  onClick={() => onAddCommand(definition.id)}
                  title={definition.description}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[9px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"
                >
                  <Plus size={10} className="shrink-0" />
                  <span className="truncate">{definition.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {CATEGORY_ORDER.filter((category) => grouped.has(category)).map(
          (category) => (
            <div key={category}>
              <p className="mb-1 px-1 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
                {CATEGORY_LABELS[category]}
              </p>
              <div className="space-y-0.5">
                {(grouped.get(category) ?? []).map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => onAddCommand(definition.id)}
                    title={definition.description}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[9px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"
                  >
                    <Plus size={10} className="shrink-0" />
                    <span className="truncate">{definition.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
        {results.length === 0 && (
          <p className="px-1 text-[9px] text-[var(--text-subtle)]">
            No actions match "{query}".
          </p>
        )}
      </div>
    </div>
  )
}
