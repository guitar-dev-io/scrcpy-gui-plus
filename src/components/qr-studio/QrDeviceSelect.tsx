import { Smartphone } from 'lucide-react'
import { Select } from '../ui'

export interface QrDeviceSelectProps {
  devices: string[]
  deviceLabels?: Record<string, string>
  activeDevice: string
  onSelectDevice: (serial: string) => void
}

/** True when `activeDevice` is a connected Android serial. `''` (iOS/companion workspace) is not. */
export function hasAndroidTarget(
  devices: readonly string[],
  activeDevice: string,
): boolean {
  return activeDevice !== '' && devices.includes(activeDevice)
}

/**
 * Device picker over the app's connected-device list. It never switches devices by itself: an
 * unplugged or non-Android active device shows the placeholder instead of an orphan value.
 */
export default function QrDeviceSelect({
  devices,
  deviceLabels,
  activeDevice,
  onSelectDevice,
}: QrDeviceSelectProps) {
  const noDevices = devices.length === 0
  return (
    <div className="flex items-center gap-2">
      <Smartphone
        size={13}
        aria-hidden="true"
        className="shrink-0 text-slate-400"
      />
      <Select
        aria-label="Target device"
        className="min-w-[180px]"
        disabled={noDevices}
        placeholder={noDevices ? 'No device connected' : 'Select device'}
        value={hasAndroidTarget(devices, activeDevice) ? activeDevice : ''}
        options={devices.map((serial) => ({
          value: serial,
          label: deviceLabels?.[serial] ?? serial,
        }))}
        onChange={onSelectDevice}
        placement="bottom-end"
      />
    </div>
  )
}
