import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { MaestroFlow } from '../../types/maestroBuilder'
import {
  MAESTRO_FLOW_TEMPLATES,
  type MaestroTemplateId,
} from '../../utils/maestroTemplates'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface MaestroFlowLibraryMenuProps {
  library: MaestroFlow[]
  activeFlowId: string
  onNew: () => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: () => void
  onTemplate: (id: MaestroTemplateId) => void
}

export default function MaestroFlowLibraryMenu({
  library,
  activeFlowId,
  onNew,
  onLoad,
  onDelete,
  onDuplicate,
  onTemplate,
}: MaestroFlowLibraryMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const sorted = [...library].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
      >
        <FolderOpen size={11} /> Flows ({library.length})
        <ChevronDown
          size={10}
          className={
            open ? 'rotate-180 transition-transform' : 'transition-transform'
          }
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-8 z-20 w-64 overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] shadow-xl"
        >
          <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] p-1.5">
            <button
              type="button"
              onClick={() => {
                onNew()
                setOpen(false)
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[8px] font-semibold text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"
            >
              <Plus size={10} /> New Flow
            </button>
            <button
              type="button"
              onClick={() => {
                onDuplicate()
                setOpen(false)
              }}
              title="Duplicate current flow"
              aria-label="Duplicate current flow"
              className="flex items-center justify-center rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"
            >
              <Copy size={11} />
            </button>
          </div>
          <div className="border-b border-[var(--border-subtle)] p-1.5">
            <p className="px-1 pb-1 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
              Start from template
            </p>
            <div className="grid grid-cols-2 gap-1">
              {MAESTRO_FLOW_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  title={template.description}
                  onClick={() => {
                    onTemplate(template.id)
                    setOpen(false)
                  }}
                  className="rounded px-2 py-1 text-left text-[8px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"
                >
                  {template.name}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {sorted.length === 0 ? (
              <p className="px-2 py-3 text-center text-[8px] text-[var(--text-subtle)]">
                No saved flows yet.
              </p>
            ) : (
              sorted.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-1 rounded-md px-2 py-1.5 ${item.id === activeFlowId ? 'bg-primary/15' : 'hover:bg-white/5'}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onLoad(item.id)
                      setOpen(false)
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[9px] font-semibold text-[var(--text-base)]">
                      {item.name}
                    </p>
                    <p className="truncate text-[8px] text-[var(--text-subtle)]">
                      {item.actions.length} actions · {timeAgo(item.updatedAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    title={`Delete ${item.name}`}
                    aria-label={`Delete ${item.name}`}
                    className="shrink-0 rounded p-1 text-[var(--text-subtle)] hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
