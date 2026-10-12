import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, ScanLine, Send, Smartphone } from 'lucide-react'
import { Select } from '../ui'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { ActionButton, DecodedList, ResultStrip } from './DeviceParts'
import { isValidPackageName, readDeepLinkHandoff } from './deepLinkBuilder'
import { decodedRecordInput, draftRenderable } from './deviceTargets'
import { TextField, labelClass, panelClass } from './formControls'
import { typeLabel } from './libraryUtils'
import { CAMERA_SCAN_EXPLANATION } from './deviceText'
import type { QrRenderable } from './qrDownloads'
import { useDeviceActions, type LaunchTarget } from './useDeviceActions'
import type { QrDraft } from './useQrDraft'
import type { UseQrStore } from './useQrStore'

export interface DeviceActionsPanelProps {
  store: UseQrStore
  devices: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  /** The Create form, offered as a target next to the saved records. */
  draft?: QrDraft
  /** Short success toasts owned by the container. */
  onStatus?: (message: string) => void
}

const DRAFT = 'draft'
const MAX_PICKER_RECORDS = 200

function Card({
  id,
  title,
  icon,
  children,
}: {
  id: string
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={`${panelClass} space-y-3 p-4`}>
      <h3
        id={id}
        className="flex items-center gap-2 text-[13px] font-semibold text-white"
      >
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

const iconClass = 'text-[#ff4f57]'

export default function DeviceActionsPanel({
  store,
  devices,
  deviceLabels,
  activeDevice,
  customPath,
  notify,
  draft,
  onStatus,
}: DeviceActionsPanelProps) {
  const status = (message: string) => onStatus?.(message)
  const device = useDeviceActions({
    devices,
    deviceLabels,
    activeDevice,
    customPath,
    notify,
    onStatus: status,
    onUsed: (id) => void store.markUsed(id),
  })
  const [sendId, setSendId] = useState(DRAFT)
  const [openId, setOpenId] = useState(DRAFT)
  const [handoff] = useState(readDeepLinkHandoff)
  const [uri, setUri] = useState(handoff?.uri ?? '')
  const [packageName, setPackageName] = useState(handoff?.packageName ?? '')
  const [libraryNote, setLibraryNote] = useState<string | null>(null)

  const live = useMemo(
    () =>
      store.state.records
        .filter((record) => !record.trashedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [store.state.records],
  )
  const shown = live.slice(0, MAX_PICKER_RECORDS)
  const draftItem = draftRenderable(draft, live.length + 1)

  const options = [
    {
      value: DRAFT,
      label: draftItem
        ? 'Current Create draft'
        : 'Current Create draft (nothing valid yet)',
      disabled: !draftItem,
    },
    ...shown.map((record) => ({
      value: record.id,
      label: `${record.name} · ${typeLabel(record.contentType)}`,
    })),
  ]

  const resolve = (
    id: string,
  ): {
    item: QrRenderable | null
    target: LaunchTarget | null
    missing: string | null
  } => {
    if (id === DRAFT) {
      return draftItem
        ? {
            item: draftItem,
            target: {
              kind: 'draft',
              content: draftItem.content,
              contentType: draftItem.contentType,
            },
            missing: null,
          }
        : {
            item: null,
            target: null,
            missing: 'The Create form has no valid content yet',
          }
    }
    const record = live.find((entry) => entry.id === id)
    return record
      ? { item: record, target: { kind: 'record', record }, missing: null }
      : { item: null, target: null, missing: 'Choose a QR code' }
  }

  const send = resolve(sendId)
  const open = resolve(openId)
  const sendReason = device.sendReason(send.item) ?? null
  const sendShown = device.hasDevice && !send.item ? send.missing : sendReason
  const openReasonValue = device.openReason(open.target)
  const openShown =
    device.hasDevice && !open.target ? open.missing : openReasonValue

  const typedTarget: LaunchTarget = { kind: 'typed', uri }
  const packageInvalid =
    packageName.trim() !== '' && !isValidPackageName(packageName)
  const typedReason =
    device.openReason(typedTarget) ??
    (packageInvalid ? 'Invalid package name' : null)

  const decodedReason = (text: string) =>
    device.openReason({ kind: 'decoded', text })

  const saveDecoded = (text: string) => {
    const result = store.saveRecord(decodedRecordInput(text))
    if (result.ok) {
      setLibraryNote('Saved to the library as a decoded code')
      status('Saved to the library')
    } else {
      setLibraryNote(result.error)
    }
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h2 className="text-[14px] font-semibold text-white">Device Actions</h2>
        <p className="mt-1 text-[11px] text-slate-400">
          {device.hasDevice
            ? `Acting on ${device.deviceName}.`
            : 'No Android device is selected. Choose one in the header to enable these actions.'}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          id="qr-da-send"
          title="Send to Device"
          icon={<Send size={14} className={iconClass} aria-hidden="true" />}
        >
          <p className="text-[11px] text-slate-400">
            Saves the QR image as a PNG in the device Downloads folder. It does
            not open or show the image.
          </p>
          <div>
            <span className={labelClass}>QR code to send</span>
            <Select
              aria-label="QR code to send"
              className="w-full"
              value={sendId}
              options={options}
              onChange={setSendId}
            />
          </div>
          <ActionButton
            reason={sendShown}
            running={device.state('send').status === 'running'}
            onClick={() => send.item && void device.sendToDevice(send.item)}
          >
            Send to device
          </ActionButton>
          <ResultStrip state={device.state('send')} label="Last send result" />
        </Card>

        <Card
          id="qr-da-open"
          title="Open on Device"
          icon={
            <Smartphone size={14} className={iconClass} aria-hidden="true" />
          }
        >
          <p className="text-[11px] text-slate-400">
            Opens the QR content on the device when it is a link. Codes that
            were not typed in Create ask you to confirm the exact link first.
          </p>
          <div>
            <span className={labelClass}>QR code to open</span>
            <Select
              aria-label="QR code to open"
              className="w-full"
              value={openId}
              options={options}
              onChange={setOpenId}
            />
          </div>
          <ActionButton
            reason={openShown}
            running={device.state('open').status === 'running'}
            onClick={() => open.target && device.openOnDevice(open.target)}
          >
            Open on device
          </ActionButton>
          <ResultStrip state={device.state('open')} label="Last open result" />
        </Card>

        <Card
          id="qr-da-capture"
          title="Capture & Decode"
          icon={<ScanLine size={14} className={iconClass} aria-hidden="true" />}
        >
          <p className="text-[11px] text-slate-400">
            Takes a screenshot of the device and reads any QR codes on it.
          </p>
          <ActionButton
            reason={device.captureReason()}
            running={device.state('capture').status === 'running'}
            onClick={() => void device.captureAndDecode()}
          >
            Capture & decode
          </ActionButton>
          <ResultStrip
            state={device.state('capture')}
            label="Last capture result"
          />
          {device.capture?.thumbnailPngBase64 && (
            <img
              alt="Device screen"
              src={`data:image/png;base64,${device.capture.thumbnailPngBase64}`}
              className="max-h-60 rounded-lg border border-[#2a374a] object-contain"
            />
          )}
          {device.capture && device.capture.texts.length > 0 && (
            <DecodedList
              texts={device.capture.texts}
              onStatus={status}
              onSave={saveDecoded}
              onOpen={(text) =>
                device.openOnDevice(
                  { kind: 'decoded', text },
                  { key: 'decoded' },
                )
              }
              openReason={decodedReason}
            />
          )}
          <ResultStrip
            state={device.state('decoded')}
            label="Last open result for decoded value"
          />
          {libraryNote && (
            <p role="status" className="text-[11px] text-slate-300">
              {libraryNote}
            </p>
          )}
        </Card>

        <Card
          id="qr-da-deeplink"
          title="Deep link test"
          icon={
            <Smartphone size={14} className={iconClass} aria-hidden="true" />
          }
        >
          <p className="text-[11px] text-slate-400">
            Type a URI to open on the device. Links you type here open without a
            confirmation.
          </p>
          <TextField
            label="URI"
            value={uri}
            onChange={setUri}
            mono
            placeholder="myapp://screen/42"
          />
          <TextField
            label="Package (optional)"
            value={packageName}
            onChange={setPackageName}
            mono
            placeholder="com.example.app"
            error={packageInvalid ? 'Invalid package name' : undefined}
          />
          {handoff && uri !== handoff.uri && (
            <button
              type="button"
              className="text-[11px] text-[#ff7a80] underline"
              onClick={() => {
                setUri(handoff.uri)
                setPackageName(handoff.packageName)
              }}
            >
              Use the Deep Link Builder output
            </button>
          )}
          <ActionButton
            reason={typedReason}
            running={device.state('deeplink').status === 'running'}
            onClick={() =>
              device.openOnDevice(typedTarget, {
                packageName: packageName.trim() || undefined,
              })
            }
          >
            Open link on device
          </ActionButton>
          <ResultStrip
            state={device.state('deeplink')}
            label="Last deep link result"
          />
        </Card>
      </div>

      <Card
        id="qr-da-camera"
        title="Scan with camera"
        icon={<Camera size={14} className={iconClass} aria-hidden="true" />}
      >
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-describedby="qr-da-camera-note"
          className="inline-flex min-h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-[#2a3749] bg-[#101b2a] px-3 text-[11px] font-semibold text-slate-200 opacity-40"
        >
          <Camera size={13} aria-hidden="true" /> Scan with camera
        </button>
        <p id="qr-da-camera-note" className="text-[11px] text-slate-400">
          {CAMERA_SCAN_EXPLANATION}
        </p>
      </Card>
      {device.launchDialog}
    </div>
  )
}
