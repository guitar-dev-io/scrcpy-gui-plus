import { useEffect, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import type { QrFieldValues } from '../../types/qrStudio'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { ActionButton, ResultStrip } from './DeviceParts'
import {
  EMPTY_DEEP_LINK,
  buildDeepLinkUri,
  validateDeepLink,
  writeDeepLinkHandoff,
  type DeepLinkParts,
} from './deepLinkBuilder'
import { TextField, inputClass, labelClass, outlineButtonClass, primaryButtonClass, secondaryButtonClass } from './formControls'
import { useDeviceActions } from './useDeviceActions'

interface DeepLinkBuilderToolProps {
  onUseInCreate: (fields: QrFieldValues) => void
  onStatus: (message: string) => void
  devices: string[]
  deviceLabels?: Record<string, string>
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

export default function DeepLinkBuilderTool({
  onUseInCreate,
  onStatus,
  devices,
  deviceLabels,
  activeDevice,
  customPath,
  notify,
}: DeepLinkBuilderToolProps) {
  const [parts, setParts] = useState<DeepLinkParts>(EMPTY_DEEP_LINK)
  const [nextRow, setNextRow] = useState(1)
  const [copyError, setCopyError] = useState<string | null>(null)
  const device = useDeviceActions({ devices, deviceLabels, activeDevice, customPath, notify, onStatus })

  const errors = validateDeepLink(parts)
  const valid = Object.keys(errors).length === 0
  const uri = valid ? buildDeepLinkUri(parts) : ''
  const packageName = parts.packageName.trim()

  useEffect(() => {
    writeDeepLinkHandoff(valid ? { uri, packageName } : null)
  }, [valid, uri, packageName])

  const set = <K extends keyof DeepLinkParts>(key: K, value: DeepLinkParts[K]) => setParts((current) => ({ ...current, [key]: value }))
  const updateRow = (id: number, change: { key?: string; value?: string }) =>
    set(
      'query',
      parts.query.map((row) => (row.id === id ? { ...row, ...change } : row)),
    )

  const copy = () =>
    navigator.clipboard.writeText(uri).then(
      () => {
        setCopyError(null)
        onStatus('Copied link')
      },
      () => setCopyError('Copy failed. Clipboard permission was denied.'),
    )

  const openReason = valid
    ? device.openReason({ kind: 'typed', uri })
    : parts.scheme
      ? 'Fix the highlighted fields first'
      : 'Enter a scheme first'

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">Build a deep link from its parts. Path, query and fragment values are percent-encoded.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Scheme"
          value={parts.scheme}
          onChange={(value) => set('scheme', value)}
          error={parts.scheme ? errors.scheme : undefined}
          hint={parts.scheme ? undefined : 'Required, for example myapp'}
          mono
          placeholder="myapp"
        />
        <TextField label="Host" value={parts.host} onChange={(value) => set('host', value)} error={errors.host} mono placeholder="open" />
      </div>
      <TextField label="Path" value={parts.path} onChange={(value) => set('path', value)} mono placeholder="/item/42" />

      <div>
        <p className={labelClass}>Query parameters</p>
        <div className="space-y-2">
          {parts.query.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                aria-label={`Query key ${index + 1}`}
                className={`${inputClass} font-mono`}
                value={row.key}
                placeholder="key"
                onChange={(event) => updateRow(row.id, { key: event.target.value })}
              />
              <input
                aria-label={`Query value ${index + 1}`}
                className={`${inputClass} font-mono`}
                value={row.value}
                placeholder="value"
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove parameter ${index + 1}`}
                className={`${secondaryButtonClass} h-9 w-9 shrink-0 px-0`}
                onClick={() =>
                  set(
                    'query',
                    parts.query.filter((entry) => entry.id !== row.id),
                  )
                }
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${secondaryButtonClass} mt-2 min-h-8`}
          onClick={() => {
            set('query', [...parts.query, { id: nextRow, key: '', value: '' }])
            setNextRow(nextRow + 1)
          }}
        >
          <Plus size={13} aria-hidden="true" /> Add parameter
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Fragment" value={parts.fragment} onChange={(value) => set('fragment', value)} mono />
        <TextField
          label="Android package (optional)"
          value={parts.packageName}
          onChange={(value) => set('packageName', value)}
          error={errors.packageName}
          mono
          placeholder="com.example.app"
        />
      </div>

      <div>
        <p className={labelClass}>URI preview</p>
        <output
          aria-label="URI preview"
          data-testid="deep-link-preview"
          className="block min-h-9 break-all rounded-lg border border-[#2a374a] bg-[#0c1624] px-3 py-2 font-mono text-[12px] text-slate-100"
        >
          {uri}
        </output>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!valid}
          onClick={() => onUseInCreate({ type: 'deep-link', uri })}
        >
          Use in Create
        </button>
        <ActionButton
          reason={openReason}
          running={device.state('deeplink').status === 'running'}
          onClick={() => device.openOnDevice({ kind: 'typed', uri }, { packageName: packageName || undefined })}
          className={outlineButtonClass}
        >
          Open on device
        </ActionButton>
        <button type="button" className={secondaryButtonClass} disabled={!valid} onClick={() => void copy()}>
          <Copy size={13} aria-hidden="true" /> Copy
        </button>
      </div>
      <ResultStrip state={device.state('deeplink')} label="Last open result" />
      {copyError && (
        <p role="alert" className="text-[11px] text-red-300">
          {copyError}
        </p>
      )}
    </div>
  )
}
