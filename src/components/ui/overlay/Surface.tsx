import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { LayerProvider } from './LayerContext'
import { getOverlayHost } from './overlayHost'
import { consumePointerClose, getFocusable, useOverlayEntry } from './overlayStack'

interface SurfaceProps {
  open: boolean
  kind: 'dialog' | 'drawer'
  modal: boolean
  /** Called for Escape when this surface is the top-most overlay. */
  onRequestClose: () => void
  /** When set, a click that starts and ends on the backdrop calls it. */
  onBackdropClose?: () => void
  /** CSS value for the container (backdrop level) z-index, e.g. var(--z-layer-dialog-backdrop). */
  backdropZ: string
  /** CSS value for the panel z-index, e.g. var(--z-layer-dialog). */
  panelZ: string
  containerClassName?: string
  panelProps: HTMLAttributes<HTMLDivElement>
  children: ReactNode
}

const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * Shared shell for Dialog and Drawer. Renders into #qr-overlay-root:
 *   container (fixed, stacking context at the backdrop token)
 *     backdrop   (modal only)
 *     panel      (panel token)
 *     layer host (sibling AFTER the panel, one above it) for menus/tooltips
 *                opened from inside the surface.
 * React portal events bubble through the React tree, so mouse/key events are
 * stopped at the container to keep them away from the opener's ancestors.
 */
export default function Surface(props: SurfaceProps) {
  if (!props.open) return null
  return <SurfaceInner {...props} />
}

function SurfaceInner({
  kind,
  modal,
  onRequestClose,
  onBackdropClose,
  backdropZ,
  panelZ,
  containerClassName,
  panelProps,
  children,
}: SurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)
  const [layerHost, setLayerHost] = useState<HTMLElement | null>(null)

  useOverlayEntry({
    open: true,
    kind,
    modal,
    containerRef,
    restoreFocus: true,
    onRequestClose,
  })

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!modal || !panel) return
    const target =
      panel.querySelector<HTMLElement>('[data-autofocus]') ?? getFocusable(panel)[0] ?? panel
    target.focus({ preventScroll: true })
  }, [modal])

  const containerStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: backdropZ,
    pointerEvents: modal ? undefined : 'none',
  }
  const { style: panelStyle, className: panelClassName, ...restPanelProps } = panelProps

  return createPortal(
    <div
      ref={containerRef}
      data-overlay-surface={kind}
      className={containerClassName}
      style={containerStyle}
      onClick={stop}
      onDoubleClick={stop}
      onMouseDown={stop}
      onKeyDown={stop}
    >
      <LayerProvider value={layerHost}>
        {modal && (
          <div
            data-overlay-backdrop=""
            aria-hidden="true"
            className="qr-overlay-fade bg-black/60"
            style={{ position: 'absolute', inset: 0, zIndex: backdropZ }}
            onMouseDown={(event) => {
              const consumed = consumePointerClose()
              pressedBackdrop.current = event.target === event.currentTarget && !consumed
            }}
            onClick={(event) => {
              const armed = pressedBackdrop.current
              pressedBackdrop.current = false
              if (armed && event.target === event.currentTarget) onBackdropClose?.()
            }}
          />
        )}
        <div
          ref={panelRef}
          {...restPanelProps}
          className={panelClassName}
          style={{ ...panelStyle, zIndex: panelZ, pointerEvents: 'auto' }}
        >
          {children}
        </div>
      </LayerProvider>
      <div
        ref={setLayerHost}
        data-overlay-layer-host=""
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: `calc(${panelZ} + 1)`,
        }}
      />
    </div>,
    getOverlayHost(),
  )
}
