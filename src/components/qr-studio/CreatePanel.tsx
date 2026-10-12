import { friendlyMessage } from '../../services/tauriRuntime'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Pencil,
  ScanLine,
  Save,
  X,
} from 'lucide-react'
import { encode } from '../../services/qrEncoders'
import { assessQrQuality, colorContrast, type QrQualityIssue, type QrQualityReport } from '../../services/qrQuality'
import { decodeQrImage } from '../../services/qrDeviceService'
import { isTauri } from '../../utils/tauriEnv'
import { Button, Dialog, useConfirm } from '../ui'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { QrDestination, QrToolId } from './destinations'
import CreateAside from './CreateAside'
import DeviceActionsAside from './DeviceActionsAside'
import DesignControls from './DesignControls'
import LivePreview, { useQrPreview } from './LivePreview'
import QualityPanel, { type VerifyState } from './QualityPanel'
import TypeFields from './TypeFields'
import TypePicker from './TypePicker'
import { MAX_BULK_LINES, validateBulkInput } from './qrBulk'
import { canCopyImage, copyQr, downloadPng, downloadSvg, renderPngBase64, type QrRenderable } from './qrDownloads'
import {
  Section,
  Segmented,
  TextField,
  outlineButtonClass,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls'
import type { UseQrDraft } from './useQrDraft'
import type { UseQrStore } from './useQrStore'

interface CreatePanelProps {
  store: UseQrStore
  draftApi: UseQrDraft
  /** Measured width of the studio container; drives the 3 / 2 / 1 column layouts. */
  containerWidth: number
  onOpenTool: (tool: QrToolId) => void
  /** Opens a full destination from the aside shortcut cards. */
  onOpenDestination?: (destination: QrDestination) => void
  onStatus: (message: string) => void
  notify: ToolbarNotifier
  /** Connected Android serials. Without devices, the aside's device actions stay disabled. */
  devices?: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice?: string
  customPath?: string
}

const NO_DEVICES: string[] = []

export const WIDE_FROM = 1060
export type CreateLayout = 'wide' | 'medium' | 'narrow'

/** Container (not viewport) widths: the app sidebar leaves roughly 1100px at a 1366px viewport. */
export function createLayoutForWidth(width: number): CreateLayout {
  if (width >= WIDE_FROM) return 'wide'
  if (width >= 1024) return 'medium'
  return 'narrow'
}

/** Drops `content-empty` when the form itself is invalid: the inline field errors already explain it. */
function withoutEmptyIssue(report: QrQualityReport, drop: boolean): QrQualityReport {
  if (!drop) return report
  const issues: QrQualityIssue[] = report.issues.filter((issue) => issue.code !== 'content-empty')
  const level = issues.some((issue) => issue.level === 'error') ? 'error' : issues.length ? 'warn' : 'ok'
  return { level, issues }
}

export default function CreatePanel({
  store,
  draftApi,
  containerWidth,
  onOpenTool,
  onOpenDestination,
  onStatus,
  notify,
  devices = NO_DEVICES,
  deviceLabels,
  activeDevice = '',
  customPath,
}: CreatePanelProps) {
  const { draft, dirty } = draftApi
  const single = draft.mode === 'single'
  const layout = createLayoutForWidth(containerWidth)
  const { confirm, confirmDialog } = useConfirm()

  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [verify, setVerify] = useState<{ key: string; state: VerifyState } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(true)
  const [previewMode, setPreviewMode] = useState<'qr' | 'design'>('qr')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateError, setTemplateError] = useState<string | undefined>()

  const encoded = useMemo(() => (single ? encode(draft.fields) : null), [single, draft.fields])
  const content = encoded?.ok ? encoded.content : null
  const fieldErrors = useMemo(() => (encoded && !encoded.ok ? encoded.errors : {}), [encoded])
  const visibleErrors = useMemo(() => {
    if (submitted) return fieldErrors
    return Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => touched.has(key)))
  }, [fieldErrors, submitted, touched])

  const bulk = useMemo(
    () => (single ? null : validateBulkInput(draft.type, draft.bulkInput, draft.style.errorCorrection)),
    [single, draft.type, draft.bulkInput, draft.style.errorCorrection],
  )

  const preview = useQrPreview(single ? content : null, draft.style.errorCorrection)

  const verifyKey = `${content ?? ''}|${draft.style.foreground}|${draft.style.background}|${draft.style.errorCorrection}`
  const verifyState: VerifyState = verify && verify.key === verifyKey ? verify.state : { status: 'idle' }
  const roundTrip =
    verifyState.status === 'verified'
      ? 'verified'
      : verifyState.status === 'mismatch'
        ? 'mismatch'
        : verifyState.status === 'undecodable'
          ? 'undecodable'
          : null

  const qualityContent = single ? (content ?? '') : (bulk?.valid[0]?.content ?? 'bulk')
  const report = withoutEmptyIssue(
    assessQrQuality({
      content: qualityContent,
      foreground: draft.style.foreground,
      background: draft.style.background,
      size: draft.style.size,
      errorCorrection: draft.style.errorCorrection,
      roundTrip,
    }),
    single && content === null,
  )
  const contrast = /^#[0-9a-fA-F]{6}$/.test(draft.style.foreground) && /^#[0-9a-fA-F]{6}$/.test(draft.style.background)
    ? colorContrast(draft.style.foreground, draft.style.background)
    : null

  const qualityBlocked = report.level === 'error'
  const nextNumber = store.state.records.filter((record) => !record.trashedAt).length + 1
  const displayName = draft.name.trim() || `QR Code ${nextNumber}`
  const renderable: QrRenderable | null =
    single && content !== null
      ? { name: displayName, content, contentType: draft.type, style: draft.style }
      : null
  const canExport = renderable !== null && !qualityBlocked && !preview.error
  const desktop = isTauri()

  const touch = (key: string) =>
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)))
  const clearFeedback = () => {
    setTouched(new Set())
    setSubmitted(false)
    setSaveError(null)
    setVerify(null)
  }

  const changeType = (type: Parameters<UseQrDraft['setType']>[0]) => {
    draftApi.setType(type)
    clearFeedback()
  }

  const finishSave = (message: string) => {
    draftApi.reset()
    clearFeedback()
    onStatus(message)
  }

  const saveSingle = () => {
    setSubmitted(true)
    setSaveError(null)
    if (content === null || qualityBlocked || preview.error) return
    // An untouched Edit keeps the stored content: encoders normalise (for example a trailing
    // slash on URLs), and that must not look like a content change that rewrites `source`.
    const original = draft.editingId ? store.state.records.find((record) => record.id === draft.editingId) : undefined
    const input = {
      name: displayName,
      content: original && !draftApi.fieldsChanged ? original.content : content,
      contentType: draft.type,
      style: draft.style,
      fields: draft.fields,
    }
    const result = draft.editingId
      ? store.saveEditedFromCreate(draft.editingId, input)
      : store.saveRecord({ ...input, source: 'created' })
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    finishSave(draft.editingId ? 'QR code updated' : 'QR code saved')
  }

  const saveBulk = async () => {
    if (!bulk || bulk.valid.length === 0 || bulk.tooMany) return
    setSaveError(null)
    if (bulk.invalid.length > 0) {
      const proceed = await confirm({
        title: `Save ${bulk.valid.length} valid, skip ${bulk.invalid.length} invalid?`,
        message: 'Invalid lines are not saved. You can fix them and save again.',
        confirmLabel: `Save ${bulk.valid.length} valid, skip ${bulk.invalid.length} invalid`,
      })
      if (!proceed) return
    }
    const result = store.saveMany(
      bulk.valid.map((entry) => ({
        name: entry.name,
        content: entry.content,
        contentType: draft.type,
        style: draft.style,
        fields: entry.fields,
        source: 'created' as const,
      })),
    )
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    finishSave(`${bulk.valid.length} QR code${bulk.valid.length === 1 ? '' : 's'} saved`)
  }

  const reset = async () => {
    if (dirty) {
      const proceed = await confirm({
        title: draft.editingId ? 'Discard your changes?' : 'Reset the form?',
        message: 'Your unsaved changes will be lost.',
        confirmLabel: draft.editingId ? 'Discard changes' : 'Reset',
        tone: 'danger',
      })
      if (!proceed) return
    }
    draftApi.reset()
    clearFeedback()
  }

  const runAction = (action: (item: QrRenderable) => Promise<unknown>, success: string, failure: string) => {
    if (!renderable) return
    action(renderable).then(
      () => onStatus(success),
      (error: unknown) => {
        console.error(`QR Studio: ${failure}`, error)
        notify(failure, friendlyMessage(error, 'Unexpected error'), 'error')
      },
    )
  }

  const copy = () => {
    if (!renderable) return
    copyQr(renderable).then(
      (kind) => onStatus(kind === 'image' ? 'QR image copied' : 'Content text copied'),
      (error: unknown) => {
        console.error('QR Studio: copy failed', error)
        notify('Copy failed', 'Clipboard permission was denied.', 'error')
      },
    )
  }

  const verifyScan = async () => {
    if (!renderable) return
    const key = verifyKey
    setVerify({ key, state: { status: 'running' } })
    try {
      const base64 = await renderPngBase64(renderable)
      const result = await decodeQrImage(base64)
      const state: VerifyState =
        result.success && result.texts.length > 0
          ? result.texts.includes(renderable.content)
            ? { status: 'verified' }
            : { status: 'mismatch', decoded: result.texts[0] }
          : { status: 'undecodable', message: result.errorCode === 'no_qr_found' ? undefined : result.error }
      setVerify({ key, state })
    } catch (error) {
      console.error('QR Studio: verify scan failed', error)
      setVerify({ key, state: { status: 'undecodable', message: friendlyMessage(error, '') || undefined } })
    }
  }

  const submitTemplate = (event: FormEvent) => {
    event.preventDefault()
    const result = store.saveTemplate(templateName, draft.style)
    if (!result.ok) {
      setTemplateError(result.error)
      return
    }
    setTemplateOpen(false)
    onStatus(`Template “${result.value.name}” saved`)
  }

  const formBlock = (
    <div className={`${panelClass} space-y-4 p-4`}>
      <h2 className="text-[14px] font-semibold text-[color:var(--qr-text)]">Create QR Code</h2>
      <Segmented
        label="Mode"
        value={draft.mode}
        options={[
          { value: 'single', label: 'Single' },
          { value: 'bulk', label: 'Bulk', title: draft.editingId ? 'Bulk is unavailable while editing' : undefined },
        ]}
        onChange={(mode) => {
          if (mode === 'bulk' && draft.editingId) return
          draftApi.setMode(mode)
        }}
      />

      {draft.editingId && (
        <div className="flex items-center justify-between rounded-lg border border-[#ff4f57]/30 bg-[#ff4f57]/10 px-3 py-2 text-[11px] text-[#ff8a90]">
          <span className="flex items-center gap-2">
            <Pencil size={12} aria-hidden="true" /> Editing saved QR code
          </span>
          <button type="button" aria-label="Cancel editing" onClick={() => void reset()} className={`${secondaryButtonClass} min-h-8`}>
            Cancel <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}
      {draft.hint && (
        <p role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/[.07] px-3 py-2 text-[11px] text-amber-300">
          {draft.hint}
        </p>
      )}

      <TextField
        label="Name"
        value={draft.name}
        onChange={draftApi.setName}
        maxLength={80}
        placeholder="e.g. Product landing page"
      />
      <TypePicker value={draft.type} onChange={changeType} />

      {single ? (
        <TypeFields fields={draft.fields} errors={visibleErrors} onChange={draftApi.setFields} onTouch={touch} />
      ) : (
        <div>
          <TextField
            label="One QR code per line"
            value={draft.bulkInput}
            onChange={draftApi.setBulkInput}
            multiline
            rows={6}
            mono
            placeholder={'Docs | https://example.com/docs\nSupport | https://example.com/support'}
            hint={`Use “Name | content” or content only. Up to ${MAX_BULK_LINES} lines.`}
          />
          <p className="mt-2 text-[11px] font-semibold text-[#ff7a80]">
            {bulk?.valid.length ?? 0} ready
            {bulk && bulk.invalid.length > 0 ? `, ${bulk.invalid.length} invalid` : ''}
          </p>
          {bulk?.tooMany && (
            <p className="mt-1 text-[11px] text-red-300">Bulk save is limited to {MAX_BULK_LINES} lines. Remove the extra lines.</p>
          )}
          {bulk && bulk.invalid.length > 0 && (
            <ul aria-label="Invalid lines" className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-red-300">
              {bulk.invalid.map((entry) => (
                <li key={entry.index}>
                  Line {entry.index} ({entry.name}): {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DesignControls style={draft.style} templates={store.state.templates} onChange={draftApi.setStyle} />
    </div>
  )

  const exportRow = (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        className={`${primaryButtonClass} min-w-0 whitespace-nowrap px-2`}
        disabled={!canExport}
        onClick={() => runAction(downloadPng, 'PNG downloaded', 'PNG export failed')}
      >
        <Download size={13} aria-hidden="true" /> Download PNG
      </button>
      <button
        type="button"
        className={`${secondaryButtonClass} min-w-0 whitespace-nowrap px-2`}
        disabled={!canExport}
        onClick={() => runAction(downloadSvg, 'SVG downloaded', 'SVG export failed')}
      >
        <Download size={13} aria-hidden="true" /> Download SVG
      </button>
      <button type="button" className={`${secondaryButtonClass} min-w-0 whitespace-nowrap px-2`} disabled={!canExport} onClick={copy}>
        <Copy size={13} aria-hidden="true" /> {canCopyImage() ? 'Copy image' : 'Copy text'}
      </button>
    </div>
  )
  const saveRow = (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {single ? (
          <button type="button" className={`${outlineButtonClass} flex-1`} disabled={preview.error !== null || qualityBlocked} onClick={saveSingle}>
            <Save size={13} aria-hidden="true" />
            {draft.editingId ? 'Save changes' : 'Save'}
          </button>
        ) : (
          <button
            type="button"
            className={`${outlineButtonClass} flex-1`}
            disabled={!bulk || bulk.valid.length === 0 || bulk.tooMany || qualityBlocked}
            onClick={() => void saveBulk()}
          >
            <Save size={13} aria-hidden="true" />
            {`Save ${bulk?.valid.length ?? 0} QR code${bulk?.valid.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button type="button" className={secondaryButtonClass} onClick={() => void reset()}>
          Reset
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => {
            setTemplateName('')
            setTemplateError(undefined)
            setTemplateOpen(true)
          }}
        >
          Save as template
        </button>
      </div>
      {saveError && (
        <p role="alert" className="text-[11px] text-red-300">
          {saveError}
        </p>
      )}
    </div>
  )
  const decodeRow = (
    <Section title="Decode Test" icon={<ScanLine size={13} className="text-[color:var(--qr-coral)]" aria-hidden="true" />}>
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={!canExport || !desktop || verifyState.status === 'running'}
        aria-describedby={desktop ? undefined : 'qr-verify-hint'}
        onClick={() => void verifyScan()}
      >
        <ScanLine size={13} aria-hidden="true" /> Verify scan
      </button>
      {!desktop && (
        <p id="qr-verify-hint" className="mt-2 text-[11px] text-[color:var(--qr-text-subtle)]">
          Requires the desktop app
        </p>
      )}
    </Section>
  )
  const exportOptions = (
    <Section title="Export Options" icon={<Download size={13} className="text-[color:var(--qr-coral)]" aria-hidden="true" />}>
      <p className="mb-2 text-[11px] text-[color:var(--qr-text-subtle)]">
        PNG at {draft.style.size} px, or a scalable SVG. Size, colors and error correction are set in the form.
      </p>
      {saveRow}
    </Section>
  )
  const previewBlock = (
    <div className={`${panelClass} space-y-4 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-[color:var(--qr-text)]">Live Preview</h2>
        <div role="group" aria-label="Preview mode" className="flex rounded-lg border border-[#2a3749] bg-[#0d1725] p-0.5">
          {([['qr', 'QR Code'], ['design', 'Design View']] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={previewMode === mode}
              onClick={() => setPreviewMode(mode)}
              className={`h-7 rounded-md px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qr-coral)]/60 ${
                previewMode === mode ? 'bg-[var(--qr-coral)] text-[color:var(--qr-text)]' : 'text-[color:var(--qr-text-subtle)] hover:text-[color:var(--qr-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {layout === 'narrow' && (
          <button
            type="button"
            aria-expanded={previewOpen}
            aria-controls="qr-create-preview-body"
            className={`${secondaryButtonClass} min-h-8`}
            onClick={() => setPreviewOpen((open) => !open)}
          >
            {previewOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </button>
        )}
      </div>
      <div id="qr-create-preview-body" hidden={layout === 'narrow' && !previewOpen}>
        {single ? (
          <LivePreview style={draft.style} preview={preview} hasContent={content !== null} />
        ) : (
          <p className="py-6 text-center text-[11px] text-slate-500">Bulk mode saves each line as its own QR code. Switch to Single to preview one.</p>
        )}
      </div>
      {previewMode === 'design' && (
        <dl aria-label="Design summary" className="grid grid-cols-2 gap-2 text-[11px]">
          {[
            ['Foreground', draft.style.foreground],
            ['Background', draft.style.background],
            ['Size', `${draft.style.size} px`],
            ['Error correction', draft.style.errorCorrection],
          ].map(([term, value]) => (
            <div key={term} className="rounded-lg border border-[#2a3749] bg-[#0d1725]/75 px-3 py-2">
              <dt className="text-[color:var(--qr-text-subtle)]">{term}</dt>
              <dd className="font-semibold text-[color:var(--qr-text)]">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {exportRow}
      <QualityPanel report={report} contrast={contrast} verify={verifyState} />
      {decodeRow}
      {exportOptions}
    </div>
  )

  const asideBlock = (
    <CreateAside
      onOpenTool={onOpenTool}
      onOpenDestination={onOpenDestination}
      deviceActions={
        <DeviceActionsAside
          draftItem={renderable}
          canSend={canExport}
          devices={devices}
          deviceLabels={deviceLabels}
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
          onStatus={onStatus}
        />
      }
    />
  )

  return (
    <div data-layout={layout} className="p-4 lg:p-6">
      {layout === 'wide' && (
        <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(240px,.6fr)] items-start gap-4">
          {formBlock}
          {previewBlock}
          {asideBlock}
        </div>
      )}
      {layout === 'medium' && (
        <div className="grid grid-cols-2 items-start gap-4">
          {formBlock}
          <div className="space-y-4">
            {previewBlock}
            {asideBlock}
          </div>
        </div>
      )}
      {layout === 'narrow' && (
        <div className="space-y-4">
          {previewBlock}
          {formBlock}
          {asideBlock}
        </div>
      )}

      <Dialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Save as template"
        description="Saves the current colors, error correction and size."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="qr-template-form">
              Save template
            </Button>
          </>
        }
      >
        <form id="qr-template-form" onSubmit={submitTemplate}>
          <TextField
            label="Template name"
            value={templateName}
            onChange={(next) => {
              setTemplateName(next)
              setTemplateError(undefined)
            }}
            error={templateError}
            maxLength={40}
            autoFocus
          />
        </form>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
