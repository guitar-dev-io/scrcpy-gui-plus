import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  Gamepad2,
  Play,
  Square,
  Pencil,
  RefreshCw,
  Loader2,
  Trash2,
  Plus,
  Keyboard,
  Info,
  MousePointerClick,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useKeymap } from '../../hooks/useKeymap'
import { keyLabel } from '../../types/keymap'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface KeymapControllerProps {
  isOpen: boolean
  onClose: () => void
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

// Drag threshold (screen px) below which a pointer up is treated as a click
// (select) rather than a move.
const DRAG_THRESHOLD_PX = 4

export default function KeymapController({
  isOpen,
  onClose,
  activeDevice,
  customPath,
  notify,
}: KeymapControllerProps) {
  const { t } = useI18n()
  const km = useKeymap({ activeDevice, customPath })

  const imgRef = useRef<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  })
  const [newProfileName, setNewProfileName] = useState('')
  // Button currently awaiting a key press to (re)bind.
  const [bindingId, setBindingId] = useState<string | null>(null)

  // Pointer drag bookkeeping for repositioning a button.
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const handleImgLoad = useCallback(() => {
    const el = imgRef.current
    if (el) setNatural({ w: el.naturalWidth, h: el.naturalHeight })
  }, [])

  // Convert a client point to device pixels on the background screenshot.
  const toDeviceCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = imgRef.current
      if (!el || natural.w === 0) return null
      const rect = el.getBoundingClientRect()
      const relX = (clientX - rect.left) / rect.width
      const relY = (clientY - rect.top) / rect.height
      return {
        x: Math.min(Math.max(relX, 0), 1) * natural.w,
        y: Math.min(Math.max(relY, 0), 1) * natural.h,
      }
    },
    [natural.w, natural.h],
  )

  // Key-binding capture: while a button is awaiting a key, the next keypress
  // binds it (Escape cancels). Runs in the capture phase so it wins over other
  // handlers while the modal is focused.
  useEffect(() => {
    if (!bindingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setBindingId(null)
        return
      }
      km.bindButtonKey(bindingId, e.key)
      setBindingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [bindingId, km])

  // Capture a first screenshot when opening with a device but no background.
  useEffect(() => {
    if (isOpen && km.hasDevice && !km.background && !km.capturing) {
      void km.captureBackground()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, km.hasDevice])

  if (!isOpen) return null

  const handleCanvasClick = (e: React.PointerEvent) => {
    // Only add buttons in edit mode, and ignore clicks that land on a button
    // (those are handled by the button's own pointer handlers).
    if (!km.editing || !km.activeProfile) return
    if ((e.target as HTMLElement).dataset.keymapButton) return
    const p = toDeviceCoords(e.clientX, e.clientY)
    if (!p) return
    const id = km.addButton(p.x, p.y, natural.w, natural.h)
    if (id) setBindingId(id)
  }

  const onButtonPointerDown = (e: React.PointerEvent, id: string) => {
    if (!km.editing) return
    e.stopPropagation()
    km.setSelectedId(id)
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onButtonPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
    if (dist > DRAG_THRESHOLD_PX) drag.moved = true
    if (drag.moved) {
      const p = toDeviceCoords(e.clientX, e.clientY)
      if (p) km.moveButton(drag.id, p.x, p.y)
    }
  }

  const onButtonPointerUp = () => {
    dragRef.current = null
  }

  const handleActivate = () => {
    if (!km.hasDevice) {
      notify(t('keymap.title'), t('keymap.noDevice'), 'warning')
      return
    }
    if (!km.activeProfile || km.activeProfile.buttons.length === 0) {
      notify(t('keymap.title'), t('keymap.needButtons'), 'warning')
      return
    }
    km.toggleActive()
  }

  const buttons = km.activeProfile?.buttons ?? []

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <Gamepad2 size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('keymap.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {activeDevice || t('keymap.noDevice')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleActivate}
              disabled={!km.hasDevice}
              title={km.active ? t('keymap.stop') : t('keymap.activate')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 ${
                km.active
                  ? 'border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50'
              }`}
            >
              {km.active ? <Square size={13} /> : <Play size={13} />}
              {km.active ? t('keymap.stop') : t('keymap.activate')}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Canvas */}
          <div className="lg:w-[58%] shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-800/60 p-4 flex flex-col items-center justify-center bg-black/30 min-h-0">
            {km.background ? (
              <div className="relative inline-block max-h-[70vh]">
                <img
                  ref={imgRef}
                  src={km.background}
                  alt="device screen"
                  onLoad={handleImgLoad}
                  className="max-h-[70vh] w-auto rounded-xl border border-zinc-800 select-none"
                  draggable={false}
                />
                {/* Interaction / overlay layer */}
                <div
                  className={`absolute inset-0 ${
                    km.editing ? 'cursor-crosshair' : ''
                  } touch-none`}
                  onPointerDown={handleCanvasClick}
                >
                  {natural.w > 0 &&
                    buttons.map((b) => {
                      const pressed = km.pressedKeys.includes(b.key)
                      const selected = km.selectedId === b.id
                      const binding = bindingId === b.id
                      return (
                        <div
                          key={b.id}
                          data-keymap-button="1"
                          onPointerDown={(e) => onButtonPointerDown(e, b.id)}
                          onPointerMove={onButtonPointerMove}
                          onPointerUp={onButtonPointerUp}
                          style={{
                            left: `${(b.x / natural.w) * 100}%`,
                            top: `${(b.y / natural.h) * 100}%`,
                          }}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full border-2 text-[11px] font-black uppercase transition-colors ${
                            km.editing ? 'cursor-grab active:cursor-grabbing' : ''
                          } ${
                            binding
                              ? 'border-amber-400 bg-amber-400/30 text-amber-100 animate-pulse'
                              : pressed
                                ? 'border-emerald-400 bg-emerald-400/40 text-white scale-110'
                                : selected
                                  ? 'border-primary bg-primary/30 text-white'
                                  : 'border-white/70 bg-black/50 text-white/90'
                          }`}
                        >
                          {binding ? '…' : b.label || '?'}
                        </div>
                      )
                    })}
                </div>
                {km.capturing && (
                  <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60">
                    <Loader2 size={14} className="animate-spin text-primary" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-zinc-600 py-20 px-6 text-center">
                {km.capturing ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : (
                  <Gamepad2 size={22} />
                )}
                <span className="text-[10px] uppercase tracking-widest mt-2">
                  {km.hasDevice
                    ? t('keymap.captureHint')
                    : t('keymap.noDevice')}
                </span>
              </div>
            )}
            <button
              onClick={() => void km.captureBackground()}
              disabled={km.capturing || !km.hasDevice}
              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all text-[9px] font-black uppercase tracking-widest disabled:opacity-30"
            >
              <RefreshCw
                size={12}
                className={km.capturing ? 'animate-spin' : ''}
              />
              {t('keymap.recapture')}
            </button>
          </div>

          {/* Controls */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="p-4 border-b border-zinc-800/60 space-y-3">
              {/* Mode toggle */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => km.toggleEditing(true)}
                  disabled={km.active}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-[9px] font-black uppercase tracking-widest disabled:opacity-30 ${
                    km.editing
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-400'
                  }`}
                >
                  <Pencil size={12} /> {t('keymap.editMode')}
                </button>
                <span
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${
                    km.active
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-600'
                  }`}
                >
                  <MousePointerClick size={12} />
                  {km.active ? t('keymap.live') : t('keymap.idle')}
                </span>
              </div>

              {/* Profile selector */}
              <div className="flex items-center gap-1.5">
                <select
                  value={km.activeProfileId ?? ''}
                  onChange={(e) => km.selectProfile(e.target.value)}
                  disabled={km.profiles.length === 0}
                  className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none disabled:opacity-40"
                >
                  {km.profiles.length === 0 ? (
                    <option value="">{t('keymap.noProfiles')}</option>
                  ) : (
                    km.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.buttons.length})
                      </option>
                    ))
                  )}
                </select>
                {km.activeProfileId && (
                  <button
                    onClick={() => km.deleteProfile(km.activeProfileId!)}
                    title={t('keymap.deleteProfile')}
                    className="p-2 rounded-md border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* New profile */}
              <div className="flex items-center gap-1.5">
                <input
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProfileName.trim()) {
                      km.createProfile(newProfileName)
                      setNewProfileName('')
                    }
                  }}
                  placeholder={t('keymap.newProfilePlaceholder')}
                  className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                />
                <button
                  onClick={() => {
                    km.createProfile(newProfileName)
                    setNewProfileName('')
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                >
                  <Plus size={12} /> {t('keymap.newProfile')}
                </button>
              </div>

              <p className="flex items-start gap-1.5 text-[9px] text-zinc-500 leading-relaxed">
                <Info size={12} className="shrink-0 mt-0.5" />
                <span>
                  {km.editing ? t('keymap.editHint') : t('keymap.liveHint')}
                </span>
              </p>
            </div>

            {/* Button list */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                  {t('keymap.bindings', { count: buttons.length })}
                </span>
              </div>
              {buttons.length === 0 ? (
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest py-6 text-center">
                  {km.activeProfile
                    ? t('keymap.noButtons')
                    : t('keymap.noProfiles')}
                </p>
              ) : (
                buttons.map((b) => {
                  const pressed = km.pressedKeys.includes(b.key)
                  const selected = km.selectedId === b.id
                  return (
                    <div
                      key={b.id}
                      onClick={() => km.setSelectedId(b.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        pressed
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : selected
                            ? 'border-primary bg-primary/10'
                            : 'border-zinc-800/60 bg-zinc-950/30'
                      }`}
                    >
                      <span className="flex items-center justify-center w-7 h-7 rounded-md border border-zinc-700 bg-black/40 text-[10px] font-black text-zinc-200">
                        {b.label || '?'}
                      </span>
                      <span className="flex-1 min-w-0 text-[10px] font-mono text-zinc-400 truncate">
                        ({b.x}, {b.y})
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setBindingId(b.id)
                        }}
                        disabled={!km.editing}
                        title={t('keymap.rebind')}
                        className="p-1.5 rounded text-zinc-500 hover:text-primary transition-colors disabled:opacity-30"
                      >
                        <Keyboard size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          km.removeButton(b.id)
                        }}
                        disabled={!km.editing}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-30"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })
              )}

              {bindingId && (
                <p className="text-[9px] text-amber-400 uppercase tracking-widest text-center py-2 animate-pulse">
                  {t('keymap.pressKey', {
                    key: keyLabel(
                      buttons.find((b) => b.id === bindingId)?.key ?? '',
                    ),
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
