import { useState } from 'react'
import { detectType, encode } from '../../services/qrEncoders'
import { assessQrQuality, colorContrast } from '../../services/qrQuality'
import { decodeQrImage } from '../../services/qrDeviceService'
import { DEFAULT_QR_STYLE, type QrErrorCorrection, type QrStyle } from '../../types/qrStudio'
import { isTauri } from '../../utils/tauriEnv'
import { Select } from '../ui'
import QualityPanel, { type VerifyState } from './QualityPanel'
import { Segmented, TextField, labelClass, secondaryButtonClass } from './formControls'
import { typeLabel } from './libraryUtils'
import { renderPngBase64, type QrRenderable } from './qrDownloads'
import type { UseQrDraft } from './useQrDraft'
import type { UseQrStore } from './useQrStore'

interface QualityToolProps {
  store: UseQrStore
  draftApi: UseQrDraft
}

const HEX = /^#[0-9a-fA-F]{6}$/
const EC_OPTIONS: Array<{ value: QrErrorCorrection; label: string }> = [
  { value: 'L', label: 'L' },
  { value: 'M', label: 'M' },
  { value: 'Q', label: 'Q' },
  { value: 'H', label: 'H' },
]
const MAX_PICKER_RECORDS = 200

export default function QualityTool({ store, draftApi }: QualityToolProps) {
  const [content, setContent] = useState('')
  const [style, setStyle] = useState<QrStyle>({ ...DEFAULT_QR_STYLE })
  const [sizeText, setSizeText] = useState(String(DEFAULT_QR_STYLE.size))
  const [loadNote, setLoadNote] = useState<string | null>(null)
  const [verify, setVerify] = useState<{ key: string; state: VerifyState } | null>(null)
  const desktop = isTauri()

  const key = `${content}|${style.foreground}|${style.background}|${style.errorCorrection}`
  const verifyState: VerifyState = verify && verify.key === key ? verify.state : { status: 'idle' }
  const roundTrip =
    verifyState.status === 'verified' || verifyState.status === 'mismatch' || verifyState.status === 'undecodable'
      ? verifyState.status
      : null

  const report = assessQrQuality({
    content,
    foreground: style.foreground,
    background: style.background,
    size: style.size,
    errorCorrection: style.errorCorrection,
    roundTrip,
  })
  const contrast = HEX.test(style.foreground) && HEX.test(style.background) ? colorContrast(style.foreground, style.background) : null

  const records = store.state.records
    .filter((record) => !record.trashedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_PICKER_RECORDS)

  const load = (nextContent: string, nextStyle: QrStyle, note: string) => {
    setContent(nextContent)
    setStyle({ ...nextStyle })
    setSizeText(String(nextStyle.size))
    setLoadNote(note)
  }

  const useDraft = () => {
    const { draft } = draftApi
    const encoded = draft.mode === 'single' ? encode(draft.fields) : null
    if (!encoded || !encoded.ok) {
      setLoadNote('The Create form has no valid content yet')
      return
    }
    load(encoded.content, draft.style, 'Loaded the current Create draft')
  }

  const run = async () => {
    const item: QrRenderable = { name: 'Quality check', content, contentType: detectType(content), style }
    const runKey = key
    setVerify({ key: runKey, state: { status: 'running' } })
    try {
      const result = await decodeQrImage(await renderPngBase64(item))
      const state: VerifyState =
        result.success && result.texts.length > 0
          ? result.texts.includes(content)
            ? { status: 'verified' }
            : { status: 'mismatch', decoded: result.texts[0] }
          : { status: 'undecodable', message: result.errorCode === 'no_qr_found' ? undefined : result.error }
      setVerify({ key: runKey, state })
    } catch (error) {
      console.error('QR Studio: quality scan check failed', error)
      setVerify({ key: runKey, state: { status: 'undecodable', message: error instanceof Error ? error.message : undefined } })
    }
  }

  const color = (field: 'foreground' | 'background', label: string) => (
    <TextField
      label={label}
      value={style[field]}
      onChange={(value) => setStyle((current) => ({ ...current, [field]: value }))}
      mono
      placeholder="#000000"
    />
  )

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">Check whether a code will scan well. Type content and a style, or load one.</p>
      <TextField label="Content" value={content} onChange={setContent} multiline rows={3} mono />
      <div className="grid gap-3 sm:grid-cols-2">
        {color('foreground', 'Foreground')}
        {color('background', 'Background')}
        <TextField
          label="Size (px)"
          type="number"
          value={sizeText}
          onChange={(value) => {
            setSizeText(value)
            const parsed = Number(value)
            if (Number.isFinite(parsed) && value.trim() !== '') setStyle((current) => ({ ...current, size: parsed }))
          }}
        />
        <Segmented
          label="Error correction"
          value={style.errorCorrection}
          options={EC_OPTIONS}
          onChange={(errorCorrection) => setStyle((current) => ({ ...current, errorCorrection }))}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" className={secondaryButtonClass} onClick={useDraft}>
          Use current Create draft
        </button>
        <div className="min-w-[200px]">
          <span className={labelClass}>Load a library record</span>
          <Select
            aria-label="Load a library record"
            className="w-full"
            value=""
            placeholder="Choose a record"
            options={records.map((record) => ({ value: record.id, label: `${record.name} · ${typeLabel(record.contentType)}` }))}
            onChange={(id) => {
              const record = records.find((entry) => entry.id === id)
              if (record) load(record.content, record.style, `Loaded “${record.name}”`)
            }}
          />
        </div>
      </div>
      {loadNote && (
        <p role="status" className="text-[11px] text-slate-300">
          {loadNote}
        </p>
      )}
      <QualityPanel report={report} contrast={contrast} verify={verifyState} />
      <div>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={!desktop || !content.trim() || verifyState.status === 'running'}
          aria-describedby={desktop ? undefined : 'qr-quality-desktop-hint'}
          onClick={() => void run()}
        >
          Run scan check
        </button>
        {!desktop && (
          <p id="qr-quality-desktop-hint" className="mt-1 text-[11px] text-slate-500">
            Requires the desktop app
          </p>
        )}
      </div>
    </div>
  )
}
