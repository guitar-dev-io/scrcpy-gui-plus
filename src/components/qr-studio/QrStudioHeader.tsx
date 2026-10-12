import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Bookmark, Link2, QrCode } from 'lucide-react'
import { Tooltip } from '../ui'
import { classNames } from '../ui/classNames'
import { QR_DESTINATIONS, type QrDestination } from './destinations'
import QrDeviceSelect from './QrDeviceSelect'

/** Container width under which tab labels collapse to icons. */
export const COMPACT_TABS_BELOW = 1100

export const tabId = (id: QrDestination) => `qr-tab-${id}`
export const panelId = (id: QrDestination) => `qr-panel-${id}`

interface QrStudioHeaderProps {
  destination: QrDestination
  onSelectDestination: (destination: QrDestination) => void
  containerWidth: number
  savedCount: number
  linkCount: number
  devices: string[]
  deviceLabels?: Record<string, string>
  activeDevice: string
  onSelectDevice: (serial: string) => void
}

export default function QrStudioHeader({
  destination,
  onSelectDestination,
  containerWidth,
  savedCount,
  linkCount,
  devices,
  deviceLabels,
  activeDevice,
  onSelectDevice,
}: QrStudioHeaderProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const iconOnly = containerWidth < COMPACT_TABS_BELOW

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = QR_DESTINATIONS.findIndex((item) => item.id === destination)
    let next = -1
    if (event.key === 'ArrowRight') next = (current + 1) % QR_DESTINATIONS.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + QR_DESTINATIONS.length) % QR_DESTINATIONS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = QR_DESTINATIONS.length - 1
    if (next < 0) return
    event.preventDefault()
    onSelectDestination(QR_DESTINATIONS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-[#202c3c] px-4 py-3 lg:px-6">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#ff656b,#ff3f49)] text-white shadow-[0_8px_25px_rgba(255,69,78,.3)]"
          aria-hidden="true"
        >
          <QrCode size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight tracking-tight text-white">QR Studio</h1>
          <p className="text-[10px] text-slate-400">Create, style, organize, and export reusable QR codes.</p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="QR Studio sections"
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-[#2a3749] bg-[#0d1725] p-1"
      >
        {QR_DESTINATIONS.map((item, index) => {
          const selected = item.id === destination
          const Icon = item.icon
          const button = (
            <button
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={selected}
              aria-controls={panelId(item.id)}
              aria-label={iconOnly ? item.label : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectDestination(item.id)}
              className={classNames(
                'flex h-9 items-center justify-center gap-2 rounded-lg text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60',
                iconOnly ? 'w-10' : 'px-3',
                selected
                  ? 'bg-[linear-gradient(135deg,#ff605f,#fa414d)] text-white shadow-[0_6px_18px_rgba(255,70,77,.25)]'
                  : 'text-slate-400 hover:text-white',
              )}
            >
              <Icon size={14} aria-hidden="true" />
              {!iconOnly && item.label}
            </button>
          )
          return iconOnly ? (
            <Tooltip key={item.id} content={item.label}>
              {button}
            </Tooltip>
          ) : (
            <span key={item.id} className="inline-flex">
              {button}
            </span>
          )
        })}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2 text-[10px]">
        <span className="flex h-10 items-center gap-2 rounded-xl border border-[#2a3545] bg-[#111c2a] px-3 text-slate-300">
          <Bookmark size={13} aria-hidden="true" />
          <b className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-white">{savedCount}</b>
          Saved
        </span>
        <span className="flex h-10 items-center gap-2 rounded-xl border border-[#ff4f57]/35 bg-[#ff4f57]/[.07] px-3 text-[#ff6970]">
          <Link2 size={13} aria-hidden="true" />
          <b className="rounded-full bg-[#ff4f57]/15 px-1.5 py-0.5">{linkCount}</b>
          Links
        </span>
        <QrDeviceSelect
          devices={devices}
          deviceLabels={deviceLabels}
          activeDevice={activeDevice}
          onSelectDevice={onSelectDevice}
        />
      </div>
    </header>
  )
}
