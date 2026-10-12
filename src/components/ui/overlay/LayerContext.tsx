import { createContext, useContext } from 'react'
import { getOverlayHost } from './overlayHost'

/**
 * Layer host of the enclosing Dialog/Drawer (a sibling of its panel), or null
 * outside any surface. Menus, selects, popovers and tooltips portal into it so
 * they render above the surface they were opened from.
 */
const LayerContext = createContext<HTMLElement | null>(null)

export const LayerProvider = LayerContext.Provider

export function useLayerHost(): HTMLElement {
  const host = useContext(LayerContext)
  return host ?? getOverlayHost()
}
