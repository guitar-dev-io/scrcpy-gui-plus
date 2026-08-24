import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, Search } from 'lucide-react'
import type { ProductCommand } from '../../types/productTooling'

interface CommandPaletteProps {
  commands: ProductCommand[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CommandPalette({ commands, open: controlledOpen, onOpenChange }: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const open = controlledOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) setQuery('')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
      } else if (event.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      [command.label, command.description, ...(command.keywords ?? [])]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle)),
    )
  }, [commands, query])

  const run = async (command: ProductCommand) => {
    if (command.disabled) return
    setOpen(false)
    await command.run()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[500] flex justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="h-fit w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4">
          <Search size={17} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              const firstEnabled = filtered.find((item) => !item.disabled)
              if (event.key === 'Enter' && firstEnabled) void run(firstEnabled)
            }}
            placeholder="Search actions, devices, and tools…"
            aria-label="Search commands"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-500">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {filtered.length === 0 && <p className="px-3 py-8 text-center text-xs text-zinc-500">No matching commands</p>}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => void run(item)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Command size={15} className="text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-zinc-100">{item.label}</span>
                {item.description && <span className="block truncate text-[10px] text-zinc-500">{item.description}</span>}
              </span>
              {item.shortcut && <kbd className="text-[9px] text-zinc-500">{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
