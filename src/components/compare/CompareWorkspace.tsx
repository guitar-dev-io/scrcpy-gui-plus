import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  ImageOff,
  Maximize2,
  RefreshCw,
  ScrollText,
  Smartphone,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { CompareSession } from '../../types/compare'
import type { ScreenshotHistoryEntry } from '../../types/screenshot'
import DifferenceCanvas from './DifferenceCanvas'

interface CompareWorkspaceProps {
  sessions: CompareSession[]
  history: ScreenshotHistoryEntry[]
  onSetReference: (sessionId: string, screenshotId: string) => void
  onDeleteSession: (sessionId: string) => void
  onRecapture?: (
    sessionId: string,
    entry: ScreenshotHistoryEntry,
  ) => void | Promise<void>
  onOpenDevice?: (serial: string) => void
  onOpenLogcat?: (serial: string) => void
}

function imageSource(path: string) {
  return /^(asset|blob|data|https?):/i.test(path) ? path : convertFileSrc(path)
}

export default function CompareWorkspace({
  sessions,
  history,
  onSetReference,
  onDeleteSession,
  onRecapture,
  onOpenDevice,
  onOpenLogcat,
}: CompareWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const scrollersRef = useRef(new Map<string, HTMLDivElement>())
  const syncingScrollRef = useRef(false)
  const [activeId, setActiveId] = useState(sessions[0]?.id || '')
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [syncPan, setSyncPan] = useState(true)
  const [recapturingId, setRecapturingId] = useState('')
  const [viewMode, setViewMode] = useState<'side-by-side' | 'overlay' | 'difference'>('side-by-side')
  const [comparisonTargetId, setComparisonTargetId] = useState('')
  const [overlayOpacity, setOverlayOpacity] = useState(50)
  const [pixelThreshold, setPixelThreshold] = useState(16)
  useEffect(() => {
    if (!sessions.some((session) => session.id === activeId)) {
      setActiveId(sessions[0]?.id || '')
    }
  }, [activeId, sessions])
  const active = sessions.find((session) => session.id === activeId)
  const entries = useMemo(() => {
    if (!active) return []
    const byId = new Map(history.map((entry) => [entry.id, entry]))
    return active.screenshotIds.flatMap((id) => {
      const found = byId.get(id)
      return found ? [found] : []
    })
  }, [active, history])
  const referenceEntry = entries.find((entry) => entry.id === active?.referenceScreenshotId)
  const comparisonTargets = entries.filter((entry) => entry.id !== active?.referenceScreenshotId)
  const targetEntry = comparisonTargets.find((entry) => entry.id === comparisonTargetId)
    ?? comparisonTargets[0]

  useEffect(() => {
    if (targetEntry && targetEntry.id !== comparisonTargetId) {
      setComparisonTargetId(targetEntry.id)
    }
  }, [comparisonTargetId, targetEntry])

  const changeZoom = (next: number) => {
    setFit(false)
    setZoom(Math.min(3, Math.max(0.25, Math.round(next * 4) / 4)))
  }

  const synchronizePan = (
    sourceId: string,
    event: UIEvent<HTMLDivElement>,
  ) => {
    if (!syncPan || syncingScrollRef.current) return
    const source = event.currentTarget
    const horizontal = source.scrollWidth > source.clientWidth
      ? source.scrollLeft / (source.scrollWidth - source.clientWidth)
      : 0
    const vertical = source.scrollHeight > source.clientHeight
      ? source.scrollTop / (source.scrollHeight - source.clientHeight)
      : 0
    syncingScrollRef.current = true
    scrollersRef.current.forEach((target, id) => {
      if (id === sourceId) return
      target.scrollLeft = horizontal * Math.max(0, target.scrollWidth - target.clientWidth)
      target.scrollTop = vertical * Math.max(0, target.scrollHeight - target.clientHeight)
    })
    requestAnimationFrame(() => { syncingScrollRef.current = false })
  }

  const recapture = async (entry: ScreenshotHistoryEntry) => {
    if (!onRecapture || recapturingId || !active) return
    setRecapturingId(entry.id)
    try {
      await onRecapture(active.id, entry)
    } finally {
      setRecapturingId('')
    }
  }

  if (!active) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-[10px] text-[var(--text-subtle)]">Capture multiple selected devices or choose screenshots and select Compare.</div>
  }

  return (
    <div ref={workspaceRef} className="flex h-full min-h-0 flex-col bg-[var(--bg-surface)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Compare session" value={active.id} onChange={(event) => setActiveId(event.target.value)} className="h-8 min-w-52 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)]">
          {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[9px] text-[var(--text-muted)]">
          Reference
          <select aria-label="Reference screenshot" value={active.referenceScreenshotId} onChange={(event) => onSetReference(active.id, event.target.value)} className="h-8 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)]">
            {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.deviceName || entry.filename}</option>)}
          </select>
        </label>
        <select aria-label="Compare view mode" value={viewMode} onChange={(event) => setViewMode(event.target.value as typeof viewMode)} className="h-8 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)]">
          <option value="side-by-side">Side by side</option>
          <option value="overlay">Overlay</option>
          <option value="difference">Difference</option>
        </select>
        {viewMode !== 'side-by-side' && targetEntry && (
          <select aria-label="Comparison target" value={targetEntry.id} onChange={(event) => setComparisonTargetId(event.target.value)} className="h-8 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)]">
            {comparisonTargets.map((entry) => <option key={entry.id} value={entry.id}>{entry.deviceName || entry.filename}</option>)}
          </select>
        )}
        {viewMode === 'overlay' && <label className="flex items-center gap-1 text-[8px] text-[var(--text-muted)]">Opacity <input aria-label="Overlay opacity" type="range" min="0" max="100" value={overlayOpacity} onChange={(event) => setOverlayOpacity(Number(event.target.value))} /></label>}
        {viewMode === 'difference' && <label className="flex items-center gap-1 text-[8px] text-[var(--text-muted)]">Threshold <input aria-label="Pixel threshold" type="number" min="0" max="255" value={pixelThreshold} onChange={(event) => setPixelThreshold(Math.min(255, Math.max(0, Number(event.target.value) || 0)))} className="h-8 w-14 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-1" /></label>}
        <div className="flex h-8 items-center rounded-lg border border-[var(--border-base)]">
          <button type="button" aria-label="Zoom out" onClick={() => changeZoom(zoom - 0.25)} className="h-full px-2 text-[var(--text-muted)] hover:text-primary"><ZoomOut size={12} /></button>
          <button type="button" onClick={() => { setFit(true); setZoom(1) }} aria-pressed={fit} className={`h-full min-w-12 border-x border-[var(--border-base)] px-2 text-[8px] ${fit ? 'text-primary' : 'text-[var(--text-muted)]'}`}>{fit ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
          <button type="button" aria-label="Zoom in" onClick={() => changeZoom(zoom + 0.25)} className="h-full px-2 text-[var(--text-muted)] hover:text-primary"><ZoomIn size={12} /></button>
        </div>
        <button type="button" aria-pressed={syncPan} onClick={() => setSyncPan((value) => !value)} className={`h-8 rounded-lg border px-2 text-[8px] ${syncPan ? 'border-primary/40 text-primary' : 'border-[var(--border-base)] text-[var(--text-muted)]'}`}>Sync pan</button>
        <button type="button" aria-label="Fullscreen compare" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : workspaceRef.current?.requestFullscreen())} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-base)] px-2 text-[8px] text-[var(--text-muted)] hover:text-primary"><Maximize2 size={11} /> Fullscreen</button>
        <button type="button" onClick={() => onDeleteSession(active.id)} className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2 text-[9px] text-red-400 hover:bg-red-500/10"><Trash2 size={11} /> Delete session</button>
      </div>
      {viewMode === 'overlay' && referenceEntry && targetEntry ? (
        <div className="relative min-h-64 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-black/30">
          <img src={imageSource(referenceEntry.path)} alt={`Reference ${referenceEntry.filename}`} className="absolute inset-0 h-full w-full object-contain" />
          <img src={imageSource(targetEntry.path)} alt={`Overlay ${targetEntry.filename}`} className="absolute inset-0 h-full w-full object-contain" style={{ opacity: overlayOpacity / 100 }} />
          <span className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-[8px] text-white">{referenceEntry.deviceName} ↔ {targetEntry.deviceName} · {overlayOpacity}%</span>
        </div>
      ) : viewMode === 'difference' && referenceEntry && targetEntry ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          <DifferenceCanvas referencePath={referenceEntry.path} targetPath={targetEntry.path} threshold={pixelThreshold} />
        </div>
      ) : entries.length > 0 ? (
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 overflow-auto">
          {entries.map((entry) => {
            const reference = entry.id === active.referenceScreenshotId
            return <article key={entry.id} className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-black/25 ${reference ? 'border-primary ring-1 ring-primary/30' : 'border-[var(--border-subtle)]'}`}>
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 text-[9px]">
                <span className="min-w-0 flex-1 truncate text-[var(--text-base)]">{entry.deviceName || entry.deviceSerial}</span>
                {reference && <span className="mr-1 text-primary">Reference</span>}
                {onRecapture && (!entry.sourceKind || entry.sourceKind === 'android-adb') && <button type="button" title="Recapture" aria-label={`Recapture ${entry.deviceName || entry.deviceSerial}`} disabled={Boolean(recapturingId)} onClick={() => void recapture(entry)} className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-40"><RefreshCw size={10} className={recapturingId === entry.id ? 'animate-spin' : ''} /></button>}
                {onOpenDevice && <button type="button" title="Device Detail" aria-label={`Open device ${entry.deviceSerial}`} onClick={() => onOpenDevice(entry.deviceSerial)} className="rounded p-1 text-[var(--text-subtle)] hover:text-primary"><Smartphone size={10} /></button>}
                {onOpenLogcat && <button type="button" title="Logcat" aria-label={`Open Logcat for ${entry.deviceSerial}`} onClick={() => onOpenLogcat(entry.deviceSerial)} className="rounded p-1 text-[var(--text-subtle)] hover:text-primary"><ScrollText size={10} /></button>}
              </div>
              <div
                ref={(element) => { if (element) scrollersRef.current.set(entry.id, element); else scrollersRef.current.delete(entry.id) }}
                onScroll={(event) => synchronizePan(entry.id, event)}
                className="min-h-56 flex-1 overflow-auto"
              >
                <img
                  src={imageSource(entry.path)}
                  alt={entry.filename}
                  className={fit ? 'h-full w-full object-contain' : 'max-w-none object-contain'}
                  style={fit ? undefined : { width: `${zoom * 100}%` }}
                />
              </div>
            </article>
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--text-subtle)]"><ImageOff size={24} /><span className="text-[9px]">Session screenshots are no longer in history.</span></div>
      )}
    </div>
  )
}
