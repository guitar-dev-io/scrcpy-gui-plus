import { useIosDevicePreview } from '../../hooks/useLivePreview'
import PreviewCardShell from './PreviewCardShell'

interface IosDevicePreviewCardProps {
  udid: string
  deviceName: string
  customPath?: string
}

export default function IosDevicePreviewCard({
  udid,
  deviceName,
  customPath,
}: IosDevicePreviewCardProps) {
  const preview = useIosDevicePreview({ udid, customPath })

  return (
    <PreviewCardShell
      title={deviceName || udid}
      subtitle={udid}
      connType="ios"
      isPreviewing={preview.isPreviewing}
      frameSrc={preview.frameSrc}
      error={preview.error}
      isLoading={preview.isLoading}
      onToggle={preview.toggle}
    />
  )
}
