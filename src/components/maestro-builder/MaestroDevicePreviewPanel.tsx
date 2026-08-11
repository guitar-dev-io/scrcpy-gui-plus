import { useCallback, useRef, useState } from 'react'
import { Loader2, RefreshCw, Smartphone } from 'lucide-react'
import { nodeAtPoint, type UiNode } from '../../types/uiInspector'

interface MaestroDevicePreviewPanelProps {
  activeDevice: string
  root: UiNode | null
  screenshot: string | null
  selected: UiNode | null
  onSelect: (node: UiNode | null) => void
  loading: boolean
  error: { message: string; code?: string } | null
  onRefresh: () => void
}

export default function MaestroDevicePreviewPanel({
  activeDevice,
  root,
  screenshot,
  selected,
  onSelect,
  loading,
  error,
  onRefresh,
}: MaestroDevicePreviewPanelProps) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [rendered, setRendered] = useState({ w: 0, h: 0 })
  const [hovered, setHovered] = useState<UiNode | null>(null)

  const handleLoad = useCallback(() => {
    const el = imgRef.current
    if (!el) return
    setNatural({ w: el.naturalWidth, h: el.naturalHeight })
    setRendered({ w: el.clientWidth, h: el.clientHeight })
  }, [])

  const pointToNode = useCallback(
    (event: React.MouseEvent): UiNode | null => {
      const el = imgRef.current
      if (!el || !root || natural.w === 0) return null
      const rect = el.getBoundingClientRect()
      const relX = (event.clientX - rect.left) / rect.width
      const relY = (event.clientY - rect.top) / rect.height
      return nodeAtPoint(root, relX * natural.w, relY * natural.h)
    },
    [root, natural],
  )

  const scale = natural.w > 0 ? rendered.w / natural.w : 1
  const boundsStyle = (node: UiNode | null) =>
    node
      ? {
          left: node.bounds.x * scale,
          top: node.bounds.y * scale,
          width: node.bounds.width * scale,
          height: node.bounds.height * scale,
        }
      : null

  const selectedRect = boundsStyle(selected)
  const hoveredRect = boundsStyle(hovered)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Device Preview</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!activeDevice || loading}
          title="Refresh"
          aria-label="Refresh device preview"
          className="ml-auto rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20 p-3">
        {!activeDevice ? (
          <div className="flex flex-col items-center gap-2 text-[var(--text-subtle)]">
            <Smartphone size={20} />
            <span className="text-[9px] uppercase tracking-widest">No device selected</span>
          </div>
        ) : loading && !screenshot ? (
          <Loader2 size={20} className="animate-spin text-primary" />
        ) : screenshot ? (
          <div className="relative inline-block max-h-full">
            <img
              ref={imgRef}
              src={screenshot}
              alt="Device screen"
              onLoad={handleLoad}
              draggable={false}
              className="max-h-[60vh] w-auto select-none rounded-lg border border-[var(--border-subtle)]"
            />
            <div
              className="absolute inset-0 cursor-crosshair"
              onMouseMove={(event) => setHovered(pointToNode(event))}
              onMouseLeave={() => setHovered(null)}
              onClick={(event) => onSelect(pointToNode(event))}
            >
              {hoveredRect && hovered?.id !== selected?.id && (
                <div className="absolute border border-sky-400/70 bg-sky-400/10 pointer-events-none" style={hoveredRect} />
              )}
              {selectedRect && (
                <div className="absolute border-2 border-primary bg-primary/10 pointer-events-none" style={selectedRect} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-[var(--text-subtle)]">
            <Smartphone size={20} />
            <span className="text-[9px] uppercase tracking-widest">{error?.message || 'No preview yet'}</span>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-on-primary"
            >
              Capture
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
