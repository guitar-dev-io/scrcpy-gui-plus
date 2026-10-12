import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { launchDeepLink } from '../../services/deepLinkService'
import { captureAndDecode as captureAndDecodeService, sendQrToDevice } from '../../services/qrDeviceService'
import { detectType, launchableUri, validateUri } from '../../services/qrEncoders'
import { qrFileName } from '../../services/qrStudioService'
import { needsLaunchConfirm } from '../../services/qrStudioStore'
import type { QrContentType, QrRecord } from '../../types/qrStudio'
import { Button, Dialog } from '../ui'
import { getOverlayStack } from '../ui/overlay/overlayStack'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { renderPngBase64, type QrRenderable } from './qrDownloads'
import { hasAndroidTarget } from './QrDeviceSelect'

export const CONNECT_TEXT = 'Connect an Android device to use this action'
export const NOT_LAUNCHABLE = 'This type is not a launchable link'
export const INVALID_PHONE = 'Invalid phone number'
export const NO_HANDLER = 'No app on the device handles this link'
export const SEND_PNG_SIZE = 1024

export type DeviceActionKey = 'send' | 'open' | 'capture' | 'deeplink' | 'decoded'

export interface ActionState {
  status: 'idle' | 'running' | 'success' | 'error'
  message?: string
}

/** What Open on Device is asked to launch. */
export type LaunchTarget =
  | { kind: 'record'; record: QrRecord }
  /** The unsaved Create draft: the user is typing it, so it never needs a confirmation. */
  | { kind: 'draft'; content: string; contentType: QrContentType }
  /** A value read from an image or the device screen. Always confirmed. */
  | { kind: 'decoded'; text: string }
  /** A URI typed into the Deep link test or the Deep Link Builder. Never confirmed. */
  | { kind: 'typed'; uri: string }

export interface LaunchInfo {
  /** The URI that would be launched, or null when the target cannot be launched. */
  uri: string | null
  /** Why `uri` is null. */
  reason: string | null
  /** True when the exact URI must be confirmed first. */
  confirm: boolean
}

function resolveUri(content: string, type: QrContentType): { uri: string | null; reason: string | null } {
  const uri = launchableUri(content, type)
  if (uri) return { uri, reason: null }
  return { uri: null, reason: type === 'sms' ? INVALID_PHONE : NOT_LAUNCHABLE }
}

export function launchInfo(target: LaunchTarget): LaunchInfo {
  switch (target.kind) {
    case 'typed': {
      if (!target.uri.trim()) return { uri: null, reason: 'Enter a URI to open', confirm: false }
      const error = validateUri(target.uri)
      return error
        ? { uri: null, reason: error, confirm: false }
        : { uri: target.uri.trim(), reason: null, confirm: false }
    }
    case 'draft':
      return { ...resolveUri(target.content, target.contentType), confirm: false }
    case 'record':
      return { ...resolveUri(target.record.content, target.record.contentType), confirm: needsLaunchConfirm(target.record) }
    case 'decoded': {
      const text = target.text.trim()
      // A decoded `sms:` link is already a view URI; `SMSTO:` goes through smsToViewUri.
      if (/^sms:/i.test(text)) {
        const error = validateUri(text)
        return { uri: error ? null : text, reason: error, confirm: true }
      }
      return { ...resolveUri(text, detectType(text)), confirm: true }
    }
  }
}

interface DeviceError {
  error?: string
  errorCode?: string
}

function describeError(result: DeviceError, fallback: string): string {
  if (result.errorCode === 'no_handler' || /Activity not started/i.test(result.error ?? '')) return NO_HANDLER
  const message = result.error?.trim() || fallback
  return result.errorCode ? `${message} (${result.errorCode})` : message
}

export interface CaptureSnapshot {
  texts: string[]
  thumbnailPngBase64?: string
}

interface Snapshot {
  device: string
  actions: Partial<Record<DeviceActionKey, ActionState>>
  capture: CaptureSnapshot | null
}

interface Pending {
  serial: string
  target: LaunchTarget
  uri: string
  packageName?: string
  key: DeviceActionKey
  running: boolean
  error?: string
}

type Outcome = { ok: true; message: string } | { ok: false; message: string }

export interface UseDeviceActionsOptions {
  devices: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  /** Short success toasts. */
  onStatus?: (message: string) => void
  /** Called with the record id after a successful Open on Device. */
  onUsed?: (recordId: string) => void
}

export interface UseDeviceActions {
  hasDevice: boolean
  serial: string
  deviceName: string
  state: (key: DeviceActionKey) => ActionState
  capture: CaptureSnapshot | null
  /** Null when the action can run, otherwise the visible reason it cannot. */
  openReason: (target: LaunchTarget | null) => string | null
  sendReason: (item: QrRenderable | null) => string | null
  captureReason: () => string | null
  openOnDevice: (target: LaunchTarget, options?: { packageName?: string; key?: DeviceActionKey }) => void
  sendToDevice: (item: QrRenderable) => Promise<void>
  captureAndDecode: () => Promise<void>
  /** Render once in the host. Shows the launch confirmation as an alertdialog. */
  launchDialog: ReactNode
}

const IDLE: ActionState = { status: 'idle' }

/** Shared logic for every device action surface (panel, Create aside, Library, Tools). */
export function useDeviceActions({
  devices,
  deviceLabels,
  activeDevice,
  customPath,
  notify,
  onStatus,
  onUsed,
}: UseDeviceActionsOptions): UseDeviceActions {
  const hasDevice = hasAndroidTarget(devices, activeDevice)
  const serial = hasDevice ? activeDevice : ''
  const deviceName = deviceLabels?.[serial] ?? serial
  const [snapshot, setSnapshot] = useState<Snapshot>({ device: '', actions: {}, capture: null })
  const [pending, setPending] = useState<Pending | null>(null)
  const running = useRef(new Set<string>())

  // Results belong to one device: switching device simply hides them.
  const view: Snapshot = snapshot.device === serial ? snapshot : { device: serial, actions: {}, capture: null }
  const pendingView = pending && pending.serial === serial ? pending : null

  const patch = useCallback((device: string, change: (current: Snapshot) => Partial<Snapshot>) => {
    setSnapshot((current) => {
      const base: Snapshot = current.device === device ? current : { device, actions: {}, capture: null }
      return { ...base, ...change(base) }
    })
  }, [])

  const setAction = useCallback(
    (device: string, key: DeviceActionKey, state: ActionState) =>
      patch(device, (current) => ({ actions: { ...current.actions, [key]: state } })),
    [patch],
  )

  /** Runs one action with double-submit prevention. Resolves null when it was already running. */
  const execute = useCallback(
    async (key: DeviceActionKey, device: string, job: () => Promise<Outcome>): Promise<Outcome | null> => {
      const guard = `${device}:${key}`
      if (running.current.has(guard)) return null
      running.current.add(guard)
      setAction(device, key, { status: 'running' })
      let outcome: Outcome
      try {
        outcome = await job()
      } catch (error) {
        console.error(`QR Studio: device action "${key}" failed`, error)
        outcome = { ok: false, message: error instanceof Error ? error.message : 'Unexpected error' }
      } finally {
        running.current.delete(guard)
      }
      setAction(device, key, { status: outcome.ok ? 'success' : 'error', message: outcome.message })
      // A modal (including the launch confirmation) shows the error inline instead.
      if (!outcome.ok && !getOverlayStack().some((entry) => entry.modal)) {
        notify('QR Studio device action failed', outcome.message, 'error')
      }
      return outcome
    },
    [notify, setAction],
  )

  const launch = useCallback(
    (device: string, name: string, key: DeviceActionKey, target: LaunchTarget, uri: string, packageName?: string) =>
      execute(key, device, async () => {
        const result = await launchDeepLink(device, uri, packageName, customPath)
        if (!result.success) return { ok: false, message: describeError(result, 'Could not open the link') }
        if (target.kind === 'record') onUsed?.(target.record.id)
        onStatus?.(`Opened on ${name}`)
        return { ok: true, message: `Opened on ${name}` }
      }),
    [customPath, execute, onStatus, onUsed],
  )

  const openReason = (target: LaunchTarget | null): string | null => {
    if (!hasDevice) return CONNECT_TEXT
    if (!target) return 'Choose something to open'
    return launchInfo(target).reason
  }

  const sendReason = (item: QrRenderable | null): string | null => {
    if (!hasDevice) return CONNECT_TEXT
    return item ? null : 'Choose a QR code to send'
  }

  const captureReason = (): string | null => (hasDevice ? null : CONNECT_TEXT)

  const openOnDevice: UseDeviceActions['openOnDevice'] = (target, options) => {
    if (!hasDevice) return
    const info = launchInfo(target)
    if (!info.uri) return
    const key = options?.key ?? (target.kind === 'typed' ? 'deeplink' : 'open')
    if (info.confirm) {
      setPending({ serial, target, uri: info.uri, packageName: options?.packageName, key, running: false })
      return
    }
    void launch(serial, deviceName, key, target, info.uri, options?.packageName)
  }

  const confirmPending = async () => {
    const current = pendingView
    if (!current || current.running) return
    setPending({ ...current, running: true, error: undefined })
    const outcome = await launch(current.serial, deviceName, current.key, current.target, current.uri, current.packageName)
    if (!outcome) return
    if (outcome.ok) setPending(null)
    else setPending((latest) => (latest ? { ...latest, running: false, error: outcome.message } : latest))
  }

  const sendToDevice = async (item: QrRenderable) => {
    if (!hasDevice) return
    const device = serial
    const name = deviceName
    await execute('send', device, async () => {
      const filename = qrFileName(item.name, 'png')
      const pngBase64 = await renderPngBase64(item, SEND_PNG_SIZE)
      const result = await sendQrToDevice(device, filename, pngBase64, customPath)
      if (!result.success) return { ok: false, message: describeError(result, 'Could not send the image') }
      const remote = result.pathOnDevice?.split('/').pop() || filename
      onStatus?.(`Saved to Downloads/${remote} on ${name}`)
      return {
        ok: true,
        message: `Saved to Downloads/${remote} on ${name}. The file is only saved; nothing opens on the device.`,
      }
    })
  }

  const captureAndDecode = async () => {
    if (!hasDevice) return
    const device = serial
    patch(device, () => ({ capture: null }))
    await execute('capture', device, async () => {
      const result = await captureAndDecodeService(device, customPath)
      if (!result.success) return { ok: false, message: describeError(result, 'Could not capture the device screen') }
      patch(device, () => ({ capture: { texts: result.texts, thumbnailPngBase64: result.thumbnailPngBase64 } }))
      return {
        ok: true,
        message:
          result.texts.length === 0
            ? 'No QR code found on the device screen'
            : `Found ${result.texts.length} QR code${result.texts.length === 1 ? '' : 's'} on the device screen`,
      }
    })
  }

  const launchDialog = (
    <Dialog
      open={pendingView !== null}
      onClose={() => setPending(null)}
      title="Open this link on the device?"
      description={`This content was not typed in the Create form. Check the exact link before it opens on ${deviceName || 'the device'}.`}
      size="md"
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" size="sm" data-autofocus="" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button size="sm" disabled={pendingView?.running} onClick={() => void confirmPending()}>
            Open on device
          </Button>
        </>
      }
    >
      <pre
        data-testid="launch-uri"
        className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#2a374a] bg-[#0c1624] p-3 font-mono text-[12px] text-slate-100"
      >
        {pendingView?.uri}
      </pre>
      {pendingView?.packageName && (
        <p className="mt-2 text-[11px] text-slate-400">
          Package: <span className="font-mono">{pendingView.packageName}</span>
        </p>
      )}
      {pendingView?.error && (
        <p role="alert" className="mt-3 text-[11px] text-red-300">
          {pendingView.error}
        </p>
      )}
    </Dialog>
  )

  return {
    hasDevice,
    serial,
    deviceName,
    state: (key) => view.actions[key] ?? IDLE,
    capture: view.capture,
    openReason,
    sendReason,
    captureReason,
    openOnDevice,
    sendToDevice,
    captureAndDecode,
    launchDialog,
  }
}
