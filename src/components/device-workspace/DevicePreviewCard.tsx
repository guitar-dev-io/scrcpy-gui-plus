import { useDevicePreview } from '../../hooks/useLivePreview'
import { connectionTypeOf } from '../../types/deviceStatus'
import PreviewCardShell from './PreviewCardShell'

interface DevicePreviewCardProps {
  serial: string
  deviceName: string
  customPath?: string
  fps: number
  /** Stagger the first frame so many devices don't all poll at once. */
  startDelayMs: number
}

export default function DevicePreviewCard({
  serial,
  deviceName,
  customPath,
  fps,
  startDelayMs,
}: DevicePreviewCardProps) {
  const preview = useDevicePreview({ serial, customPath, fps, startDelayMs })
  const conn = connectionTypeOf(serial)

  return (
    <PreviewCardShell
      title={deviceName || serial}
      subtitle={serial}
      connType={conn === 'wifi' ? 'wifi' : 'usb'}
      isPreviewing={preview.isPreviewing}
      frameSrc={preview.frameSrc}
      error={preview.error}
      isLoading={preview.isLoading}
      onToggle={preview.toggle}
    />
  )
}
