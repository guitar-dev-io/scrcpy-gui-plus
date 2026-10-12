import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { generateQrSvg } from '../../services/deepLinkService'
import { colorContrast, CONTRAST_WARN } from '../../services/qrQuality'
import { styleQrSvg } from '../../services/qrStudioService'
import { MAX_TEMPLATE_NAME } from '../../services/qrStudioStore'
import type { QrStyle, QrTemplate } from '../../types/qrStudio'
import { useConfirm } from '../ui'
import { TextField, panelClass, primaryButtonClass, secondaryButtonClass } from './formControls'
import type { UseQrStore } from './useQrStore'

const SAMPLE_CONTENT = 'https://example.com'
let samplePromise: Promise<string> | null = null

/** One cached, unstyled sample code shared by every template card. A failure is not cached. */
function loadSampleSvg(): Promise<string> {
  if (!samplePromise) {
    samplePromise = generateQrSvg(SAMPLE_CONTENT, 'M').catch((error: unknown) => {
      samplePromise = null
      throw error
    })
  }
  return samplePromise
}

/** Test helper: forget the cached sample so the next mount generates it again. */
export function resetTemplateSample(): void {
  samplePromise = null
}

interface TemplatesPanelProps {
  store: UseQrStore
  /** Ids of the library records selected in Library (shared through the container). */
  selection: ReadonlySet<string>
  onApplyToCreate: (style: QrStyle) => void
  onStatus: (message: string) => void
}

export function lowContrastWarning(style: QrStyle): string | null {
  const ratio = colorContrast(style.foreground, style.background)
  return ratio < CONTRAST_WARN ? `Contrast ${ratio.toFixed(1)}:1 is low. Scanners may struggle.` : null
}

export default function TemplatesPanel({ store, selection, onApplyToCreate, onStatus }: TemplatesPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const [sample, setSample] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | undefined>()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadSampleSvg().then(
      (svg) => {
        if (active) setSample(svg)
      },
      (error: unknown) => console.warn('QR Studio: template sample unavailable', error),
    )
    return () => {
      active = false
    }
  }, [])

  const selectedIds = store.state.records
    .filter((record) => !record.trashedAt && selection.has(record.id))
    .map((record) => record.id)

  const applyToSelected = (template: QrTemplate) => {
    let failure: string | null = null
    for (const id of selectedIds) {
      const record = store.state.records.find((item) => item.id === id)
      if (!record) continue
      const result = store.saveEditedFromCreate(id, {
        name: record.name,
        content: record.content,
        contentType: record.contentType,
        style: { ...template.style },
        fields: record.fields,
      })
      if (!result.ok) {
        failure = result.error
        break
      }
    }
    const text = failure ?? `Applied “${template.name}” to ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}`
    setMessage(text)
    if (!failure) onStatus(text)
  }

  const submitRename = (event: FormEvent, template: QrTemplate) => {
    event.preventDefault()
    const result = store.renameTemplate(template.id, renameValue)
    if (!result.ok) {
      setRenameError(result.error)
      return
    }
    setRenamingId(null)
    setMessage(`Renamed to “${result.value.name}”`)
  }

  const remove = async (template: QrTemplate) => {
    const proceed = await confirm({
      title: `Delete “${template.name}”?`,
      message: 'Records that already use this style keep it.',
      confirmLabel: 'Delete template',
      tone: 'danger',
    })
    if (!proceed) return
    const result = store.deleteTemplate(template.id)
    setMessage(result.ok ? `Deleted “${template.name}”` : result.error)
  }

  return (
    <div className="p-4 lg:p-6">
      <div className={`${panelClass} p-4`}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-[color:var(--qr-text)]">Templates</h2>
          <p className="text-[11px] text-slate-400">
            A template stores colors, error correction and size. Save one from the Create tab.
          </p>
        </div>
        {selectedIds.length === 0 ? (
          <p id="tpl-selection-hint" className="mb-3 text-[11px] text-slate-500">
            Select records in Library first to enable “Apply to selected”.
          </p>
        ) : (
          <p className="mb-3 text-[11px] text-slate-300">
            {selectedIds.length} Library record{selectedIds.length === 1 ? '' : 's'} selected.
          </p>
        )}
        <div role="status" className="mb-3 min-h-4 text-[11px] text-slate-300">
          {message}
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {store.state.templates.map((template) => {
            const warning = lowContrastWarning(template.style)
            const renaming = renamingId === template.id
            return (
              <li key={template.id}>
                <article aria-label={template.name} className="flex h-full flex-col gap-3 rounded-xl border border-[#293649] bg-[#101b2a] p-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 p-1.5"
                      style={{ backgroundColor: template.style.background }}
                      aria-hidden="true"
                    >
                      {sample ? (
                        <div
                          data-testid="template-mini-qr"
                          className="h-full w-full [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: styleQrSvg(sample, { ...template.style, size: 80 }) }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="h-6 w-6 rounded" style={{ backgroundColor: template.style.foreground }} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {renaming ? (
                        <form onSubmit={(event) => submitRename(event, template)} className="space-y-2">
                          <TextField
                            label="Template name"
                            value={renameValue}
                            onChange={(next) => {
                              setRenameValue(next)
                              setRenameError(undefined)
                            }}
                            error={renameError}
                            maxLength={MAX_TEMPLATE_NAME}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button type="submit" className={`${primaryButtonClass} min-h-8`}>
                              <Check size={12} aria-hidden="true" /> Save name
                            </button>
                            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => setRenamingId(null)}>
                              <X size={12} aria-hidden="true" /> Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <h3 className="truncate text-[12px] font-semibold text-[color:var(--qr-text)]">{template.name}</h3>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {template.builtIn ? 'Built-in' : 'Yours'} · {template.style.errorCorrection} · {template.style.size}px
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-400">
                            {template.style.foreground} on {template.style.background}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  {warning && (
                    <p className="text-[11px] text-amber-300">
                      {warning}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${primaryButtonClass} min-h-8`}
                      onClick={() => {
                        onApplyToCreate({ ...template.style })
                        onStatus(warning ? `Applied “${template.name}”. ${warning}` : `Applied “${template.name}”`)
                      }}
                    >
                      Apply to Create
                    </button>
                    <button
                      type="button"
                      className={`${secondaryButtonClass} min-h-8`}
                      disabled={selectedIds.length === 0}
                      aria-describedby={selectedIds.length === 0 ? 'tpl-selection-hint' : undefined}
                      onClick={() => applyToSelected(template)}
                    >
                      Apply to selected
                    </button>
                    {!template.builtIn && !renaming && (
                      <>
                        <button
                          type="button"
                          className={`${secondaryButtonClass} min-h-8`}
                          aria-label={`Rename ${template.name}`}
                          onClick={() => {
                            setRenamingId(template.id)
                            setRenameValue(template.name)
                            setRenameError(undefined)
                          }}
                        >
                          <Pencil size={12} aria-hidden="true" /> Rename
                        </button>
                        <button
                          type="button"
                          className={`${secondaryButtonClass} min-h-8`}
                          aria-label={`Delete ${template.name}`}
                          onClick={() => void remove(template)}
                        >
                          <Trash2 size={12} aria-hidden="true" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </article>
              </li>
            )
          })}
        </ul>
      </div>
      {confirmDialog}
    </div>
  )
}
