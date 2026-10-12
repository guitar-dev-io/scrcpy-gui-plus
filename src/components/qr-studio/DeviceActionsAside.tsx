import { Smartphone } from 'lucide-react'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { ActionButton, DecodedList, ResultStrip } from './DeviceParts'
import { CAMERA_SCAN_EXPLANATION } from './deviceText'
import { Section } from './formControls'
import type { QrRenderable } from './qrDownloads'
import { useDeviceActions } from './useDeviceActions'

interface DeviceActionsAsideProps {
  /** The Create draft as an image, or null while the form is invalid or in bulk mode. */
  draftItem: QrRenderable | null
  /** False while the draft has quality errors or the preview failed. */
  canSend: boolean
  devices: string[]
  deviceLabels?: Record<string, string>
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  onStatus: (message: string) => void
}

/** Compact Device Actions for the code being created. The unsaved draft never needs a confirmation. */
export default function DeviceActionsAside({
  draftItem,
  canSend,
  devices,
  deviceLabels,
  activeDevice,
  customPath,
  notify,
  onStatus,
}: DeviceActionsAsideProps) {
  const device = useDeviceActions({ devices, deviceLabels, activeDevice, customPath, notify, onStatus })
  const target = draftItem ? ({ kind: 'draft', content: draftItem.content, contentType: draftItem.contentType } as const) : null
  const missing = 'The form has no valid code yet'
  const sendReason = device.hasDevice ? (!draftItem ? missing : canSend ? null : 'Fix the quality errors first') : device.sendReason(null)
  const openReason = device.hasDevice && !target ? missing : device.openReason(target)

  return (
    <Section title="Device Actions" icon={<Smartphone size={13} className="text-[#ff4f57]" aria-hidden="true" />}>
      <div className="space-y-3">
        <p className="text-[11px] text-slate-400">
          {device.hasDevice ? `Acting on ${device.deviceName}.` : 'No Android device is selected.'}
        </p>
        <ActionButton
          reason={sendReason}
          running={device.state('send').status === 'running'}
          onClick={() => draftItem && void device.sendToDevice(draftItem)}
        >
          Send to device
        </ActionButton>
        <ResultStrip state={device.state('send')} label="Last send result" />
        <ActionButton
          reason={openReason}
          running={device.state('open').status === 'running'}
          onClick={() => target && device.openOnDevice(target)}
        >
          Open on device
        </ActionButton>
        <ResultStrip state={device.state('open')} label="Last open result" />
        <ActionButton
          reason={device.captureReason()}
          running={device.state('capture').status === 'running'}
          onClick={() => void device.captureAndDecode()}
        >
          Capture & decode
        </ActionButton>
        <ResultStrip state={device.state('capture')} label="Last capture result" />
        {device.capture && device.capture.texts.length > 0 && <DecodedList texts={device.capture.texts} onStatus={onStatus} />}
        <div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-describedby="qr-aside-camera-note"
            className="inline-flex min-h-9 cursor-not-allowed items-center rounded-lg border border-[#2a3749] bg-[#101b2a] px-3 text-[11px] font-semibold text-slate-200 opacity-40"
          >
            Scan with camera
          </button>
          <p id="qr-aside-camera-note" className="mt-1 text-[11px] text-slate-400">
            {CAMERA_SCAN_EXPLANATION}
          </p>
        </div>
      </div>
      {device.launchDialog}
    </Section>
  )
}
