import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { shortClassName, type UiNode } from '../../types/uiInspector'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import type { MaestroBuilderSelector, MaestroCommandId } from '../../types/maestroBuilder'

interface TreeRowProps {
  node: UiNode
  selectedId: number | null
  onSelect: (node: UiNode) => void
  query: string
}

function nodeMatches(node: UiNode, query: string): boolean {
  return (
    node.className.toLowerCase().includes(query) ||
    node.resourceId.toLowerCase().includes(query) ||
    node.text.toLowerCase().includes(query) ||
    node.contentDesc.toLowerCase().includes(query)
  )
}

function TreeRow({ node, selectedId, onSelect, query }: TreeRowProps) {
  const [open, setOpen] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0
  const matches = !query || nodeMatches(node, query)
  const childMatch = useMemo(() => {
    if (!query) return true
    const stack = [...node.children]
    while (stack.length) {
      const n = stack.pop()!
      if (nodeMatches(n, query)) return true
      stack.push(...n.children)
    }
    return false
  }, [node, query])

  if (query && !matches && !childMatch) return null

  const idLabel = node.resourceId ? node.resourceId.split('/').pop() : node.text || node.contentDesc

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-md pr-2 cursor-pointer ${selectedId === node.id ? 'bg-primary/20 text-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}
        style={{ paddingLeft: `${node.depth * 10 + 2}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((o) => !o)
          }}
          tabIndex={hasChildren ? 0 : -1}
          aria-label={open ? 'Collapse' : 'Expand'}
          aria-hidden={!hasChildren}
          className={`p-0.5 shrink-0 ${hasChildren ? '' : 'opacity-0 pointer-events-none'}`}
        >
          <ChevronRight size={10} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <span className="truncate py-0.5 text-[9px] font-semibold">
          {shortClassName(node.className)}
          {idLabel && <span className="font-normal text-[var(--text-subtle)]"> · {idLabel}</span>}
        </span>
      </div>
      {open && hasChildren && node.children.map((child) => (
        <TreeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} query={query} />
      ))}
    </div>
  )
}

interface MaestroElementInspectorPanelProps {
  root: UiNode | null
  selected: UiNode | null
  onSelect: (node: UiNode) => void
  onQuickAction: (commandId: MaestroCommandId, selector: MaestroBuilderSelector) => void
}

const QUICK_ACTIONS: Array<{ id: MaestroCommandId; label: string }> = [
  { id: 'tapOn', label: 'Tap' },
  { id: 'assertVisible', label: 'Assert Visible' },
  { id: 'longPressOn', label: 'Long Press' },
  { id: 'scrollUntilVisible', label: 'Scroll Until Visible' },
]

export default function MaestroElementInspectorPanel({
  root,
  selected,
  onSelect,
  onQuickAction,
}: MaestroElementInspectorPanelProps) {
  const [tab, setTab] = useState<'hierarchy' | 'element'>('hierarchy')
  const [query, setQuery] = useState('')

  const recommendations = useMemo(
    () => (root && selected ? recommendMaestroSelectors(root, selected) : []),
    [root, selected],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-[var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={() => setTab('hierarchy')}
          className={`h-6 flex-1 rounded-md text-[8px] font-semibold ${tab === 'hierarchy' ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}
        >
          Hierarchy
        </button>
        <button
          type="button"
          onClick={() => setTab('element')}
          className={`h-6 flex-1 rounded-md text-[8px] font-semibold ${tab === 'element' ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-white/5'}`}
        >
          Selected Element
        </button>
      </div>

      {tab === 'hierarchy' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative shrink-0 p-2">
            <Search size={10} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value.toLowerCase())}
              placeholder="Search in hierarchy..."
              className="h-6 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] pl-6 pr-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {root ? (
              <TreeRow node={root} selectedId={selected?.id ?? null} onSelect={onSelect} query={query} />
            ) : (
              <p className="p-2 text-[9px] text-[var(--text-subtle)]">Refresh the device preview to load the hierarchy.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!selected ? (
            <p className="text-[9px] text-[var(--text-subtle)]">Select an element on the device preview or hierarchy.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                {[
                  ['Type', selected.className || '—'],
                  ['Text', selected.text || '—'],
                  ['Resource ID', selected.resourceId || '—'],
                  ['Content Description', selected.contentDesc || '—'],
                  ['Enabled', String(selected.enabled)],
                  ['Clickable', String(selected.clickable)],
                  ['Focusable', String(selected.focusable)],
                  ['Bounds', `[${selected.bounds.x},${selected.bounds.y}][${selected.bounds.x + selected.bounds.width},${selected.bounds.y + selected.bounds.height}]`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-2 border-b border-[var(--border-subtle)]/50 py-1 text-[9px]">
                    <span className="w-24 shrink-0 font-black uppercase tracking-wider text-[var(--text-subtle)]">{label}</span>
                    <span className="break-all text-[var(--text-muted)]">{value}</span>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Recommended Selectors</p>
                <div className="space-y-1">
                  {recommendations.map((rec) => (
                    <div key={`${rec.label}-${rec.selector.value}`} className="rounded-md border border-[var(--border-subtle)] bg-black/10 px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-semibold text-[var(--text-muted)]">{rec.label}</span>
                        <span className="text-[8px] text-amber-400">{'★'.repeat(rec.stars)}{'☆'.repeat(5 - rec.stars)}</span>
                      </div>
                      <p className="truncate text-[9px] text-[var(--text-base)]">{rec.selector.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Quick Actions</p>
                <div className="grid grid-cols-2 gap-1">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={recommendations.length === 0}
                      onClick={() => onQuickAction(action.id, recommendations[0].selector)}
                      className="rounded-md border border-primary/25 px-2 py-1.5 text-[8px] font-semibold text-primary hover:bg-primary/10 disabled:opacity-30"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
