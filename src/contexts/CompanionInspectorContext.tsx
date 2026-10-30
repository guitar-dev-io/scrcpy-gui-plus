import { createContext } from 'react'
import type { CompanionRequest } from '../types/companion'

/**
 * A connected Companion phone that can describe its screen (`ui_dump`) and supply
 * the current frame. When no adb device is selected, the UI Inspector and the
 * Maestro builder read the screen from here instead.
 */
export interface CompanionInspectorSource {
  name: string
  request: CompanionRequest
  getFrame: () => string | null
}

export const CompanionInspectorContext = createContext<CompanionInspectorSource | null>(null)
