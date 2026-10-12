import { Library, Palette, QrCode, Smartphone, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type QrDestination = 'create' | 'templates' | 'device-actions' | 'tools' | 'library'

export const QR_DESTINATIONS: ReadonlyArray<{
  id: QrDestination
  label: string
  subtitle: string
  icon: LucideIcon
}> = [
  { id: 'create', label: 'Create', subtitle: 'Generate QR codes', icon: QrCode },
  { id: 'templates', label: 'Templates', subtitle: 'Predefined styles', icon: Palette },
  { id: 'device-actions', label: 'Device Actions', subtitle: 'Test on connected device', icon: Smartphone },
  { id: 'tools', label: 'Tools', subtitle: 'Scan · Validate · Convert', icon: Wrench },
  { id: 'library', label: 'Library', subtitle: 'Manage & organize', icon: Library },
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
