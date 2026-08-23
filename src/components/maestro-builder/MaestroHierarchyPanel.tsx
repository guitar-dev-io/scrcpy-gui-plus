import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Eye, EyeOff, Search } from 'lucide-react'
import { shortClassName, type UiNode } from '../../types/uiInspector'

interface TreeRowProps {
  node: UiNode
  selectedId: number | null
  onSelect: (node: UiNode) => void
  query: string
}

function nodeMatches(node: UiNode, query: string): boolean {
  const needle = query.toLowerCase()
  return [node.className, node.resourceId, node.text, node.contentDesc].some(
    (value) => value.toLowerCase().includes(needle),
  )
}

function descendantMatches(node: UiNode, query: string): boolean {
  return node.children.some(
    (child) => nodeMatches(child, query) || descendantMatches(child, query),
  )
}

function TreeRow({ node, selectedId, onSelect, query }: TreeRowProps) {
  const [open, setOpen] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0
  const visible = node.bounds.width > 0 && node.bounds.height > 0
  const matches = !query || nodeMatches(node, query)
  const childMatch = useMemo(
    () => !query || descendantMatches(node, query),
    [node, query],
  )

  useEffect(() => {
    if (query && childMatch) setOpen(true)
  }, [childMatch, query])

  if (query && !matches && !childMatch) return null
  const idLabel = node.resourceId.split('/').pop() || node.text || node.contentDesc

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={selectedId === node.id}
        tabIndex={0}
        className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${selectedId === node.id ? 'bg-primary/20 text-primary' : 'text-[var(--text-muted)] hover:bg-white/5'}`}
        style={{ paddingLeft: `${node.depth * 10 + 2}px` }}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect(node)
          if (event.key === 'ArrowRight' && hasChildren) setOpen(true)
          if (event.key === 'ArrowLeft' && hasChildren) setOpen(false)
        }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
          tabIndex={-1}
          aria-label={open ? 'Collapse element' : 'Expand element'}
          className={`shrink-0 rounded p-0.5 ${hasChildren ? '' : 'pointer-events-none opacity-0'}`}
        >
          <ChevronRight size={10} className={open ? 'rotate-90' : ''} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[9px]">
          <span className="font-semibold">{shortClassName(node.className)}</span>
          {idLabel && <span className="text-[var(--text-subtle)]"> · {idLabel}</span>}
        </span>
        {visible ? (
          <Eye size={9} className="shrink-0 text-emerald-400/70" aria-label="Visible" />
        ) : (
          <EyeOff size={9} className="shrink-0 text-[var(--text-subtle)]" aria-label="Not visible" />
        )}
      </div>
      {open && hasChildren && node.children.map((child) => (
        <TreeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} query={query} />
      ))}
    </div>
  )
}

interface MaestroHierarchyPanelProps {
  root: UiNode | null
  selected: UiNode | null
  onSelect: (node: UiNode) => void
  onRefresh?: () => void
  showHeader?: boolean
}

export default function MaestroHierarchyPanel({ root, selected, onSelect, showHeader = true }: MaestroHierarchyPanelProps) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [draft])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader && <div className="flex h-8 shrink-0 items-center border-b border-[var(--border-subtle)] px-3">
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-muted)]">Hierarchy</span>
        <span className="ml-2 text-[8px] text-[var(--text-subtle)]">UI Tree</span>
      </div>}
      <div className="relative shrink-0 p-2">
        <Search size={10} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search element…"
          aria-label="Search hierarchy by id, text, or class"
          className="h-7 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] pl-6 pr-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/60"
        />
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {root ? (
          <TreeRow node={root} selectedId={selected?.id ?? null} onSelect={onSelect} query={query.toLowerCase()} />
        ) : (
          <p className="p-3 text-center text-[9px] text-[var(--text-subtle)]">Refresh Device Preview to load the live hierarchy.</p>
        )}
      </div>
    </div>
  )
}
