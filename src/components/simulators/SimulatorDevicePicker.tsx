import { useEffect, useRef, useState } from 'react'
import { Apple, ChevronDown, Search, Smartphone } from 'lucide-react'
import { useI18n } from '../../i18n'
import { filterDevices, groupByPlatform, formatStateLabel } from './simulatorsModel'
import type { SimulatorDevice } from '../../types/simDeck'

interface SimulatorDevicePickerProps {
  devices: SimulatorDevice[]
  activeUdid: string | null
  onSelect: (udid: string) => void
}

export default function SimulatorDevicePicker({ devices, activeUdid, onSelect }: SimulatorDevicePickerProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const active = devices.find((d) => d.udid === activeUdid) ?? null
  const groups = groupByPlatform(filterDevices(devices, query))

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const select = (udid: string) => {
    onSelect(udid)
    setOpen(false)
  }

  const renderRow = (device: SimulatorDevice) => {
    const Icon = device.platform === 'android' ? Smartphone : Apple
    return (
      <button
        key={device.udid}
        onClick={() => select(device.udid)}
        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/5 ${
          device.udid === activeUdid ? 'bg-primary/10' : ''
        }`}
      >
        <Icon size={14} className="shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-bold text-zinc-200">{device.name}</span>
          <span className="block truncate text-[9px] text-zinc-500">{device.runtimeName}</span>
        </span>
        <span
          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${
            device.isBooted
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
              : 'border-zinc-800 bg-zinc-900 text-zinc-500'
          }`}
        >
          {formatStateLabel(device.state)}
        </span>
      </button>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[200px] items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {active ? (
          <>
            {active.platform === 'android' ? (
              <Smartphone size={14} className="shrink-0 text-zinc-500" />
            ) : (
              <Apple size={14} className="shrink-0 text-zinc-500" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-bold text-zinc-200">{active.name}</span>
              <span className="block truncate text-[9px] text-zinc-500">{active.runtimeName}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 truncate text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {t('simulators.pickerPlaceholder')}
          </span>
        )}
        <ChevronDown size={14} className="shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-800 bg-zinc-950/98 p-2 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/30 px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-zinc-600" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('simulators.pickerSearchPlaceholder')}
              aria-label={t('simulators.pickerSearchPlaceholder')}
              className="w-full bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto custom-scrollbar">
            {groups.ios.length === 0 && groups.android.length === 0 ? (
              <p className="px-3 py-4 text-center text-[10px] text-zinc-600">
                {t('simulators.pickerNoResults')}
              </p>
            ) : (
              <>
                {groups.ios.map(renderRow)}
                {groups.android.map(renderRow)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
