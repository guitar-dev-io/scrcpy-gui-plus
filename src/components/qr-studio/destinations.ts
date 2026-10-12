import { Library, Palette, QrCode, Smartphone, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type QrDestination = 'create' | 'templates' | 'device-actions' | 'tools' | 'library'

export const QR_DESTINATIONS: ReadonlyArray<{
  id: QrDestination
  label: string
  icon: LucideIcon
}> = [
  { id: 'create', label: 'Create', icon: QrCode },
  { id: 'templates', label: 'Templates', icon: Palette },
  { id: 'device-actions', label: 'Device Actions', icon: Smartphone },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'library', label: 'Library', icon: Library },
]

export type QrToolId = 'deep-link-builder' | 'wifi' | 'decoder' | 'quality'

export const QR_TOOLS: ReadonlyArray<{ id: QrToolId; label: string }> = [
  { id: 'deep-link-builder', label: 'Deep Link Builder' },
  { id: 'wifi', label: 'Wi-Fi QR' },
  { id: 'decoder', label: 'Decoder' },
  { id: 'quality', label: 'Quality Check' },
]

export const QR_TAB_STORAGE_KEY = 'scrcpy-gui-plus:qr-studio:tab'

export function isQrDestination(value: unknown): value is QrDestination {
  return QR_DESTINATIONS.some((destination) => destination.id === value)
}
