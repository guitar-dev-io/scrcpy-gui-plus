import { useState } from 'react'
import { ChevronRight, Crosshair } from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroBuilderSelectorType,
  MaestroSelectorRelation,
} from '../../types/maestroBuilder'

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

const SELECTOR_LABELS: Record<MaestroBuilderSelectorType, string> = {
  id: 'ID',
  text: 'Text',
  index: 'Index',
  point: 'Point',
  css: 'CSS',
}

// Verified shape against https://docs.maestro.dev/reference/selectors/relational-selectors —
// above/below/leftOf/rightOf are position-based, containsChild/childOf are
// direct parent-child, containsDescendants matches at any depth.
const RELATION_OPTIONS: Array<{ value: MaestroSelectorRelation; label: string }> = [
  { value: 'above', label: 'above' },
  { value: 'below', label: 'below' },
  { value: 'leftOf', label: 'leftOf' },
  { value: 'rightOf', label: 'rightOf' },
  { value: 'containsChild', label: 'containsChild' },
  { value: 'childOf', label: 'childOf' },
  { value: 'containsDescendants', label: 'containsDescendants' },
]

interface MaestroSelectorEditorProps {
  selector: MaestroBuilderSelector | undefined
  supportedSelectors: MaestroBuilderSelectorType[]
  onChange: (selector: MaestroBuilderSelector) => void
  onPickElement?: () => void
}

export default function MaestroSelectorEditor({
  selector,
  supportedSelectors,
  onChange,
  onPickElement,
}: MaestroSelectorEditorProps) {
  const type = selector?.type ?? supportedSelectors[0] ?? 'text'
  const value = selector?.value ?? ''
  const relation = selector?.relation
  const relatedValue = selector?.relatedValue ?? ''
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(relation))

  const hasPrimaryValue = value.trim().length > 0

  // Applies a partial update on top of the current selector without ever
  // listing the same key twice in one object literal (TS flags that as an
  // error) and without relying on spread-then-override ordering (TS flags a
  // literal key that a later spread could silently overwrite too).
  const patchSelector = (patch: Partial<MaestroBuilderSelector>): MaestroBuilderSelector => {
    const next: MaestroBuilderSelector = { type, value }
    const nextRelation = 'relation' in patch ? patch.relation : relation
    const nextRelatedValue = 'relatedValue' in patch ? patch.relatedValue : selector?.relatedValue
    if ('type' in patch && patch.type) next.type = patch.type
    if ('value' in patch && patch.value !== undefined) next.value = patch.value
    if (nextRelation) next.relation = nextRelation
    if (nextRelatedValue !== undefined) next.relatedValue = nextRelatedValue
    return next
  }

  const updateRelation = (nextRelation: MaestroSelectorRelation | '') => {
    if (nextRelation === '') {
      // Drop `relation`/`relatedValue` entirely — a cleared relation isn't
      // represented by empty strings, it's simply absent from the selector.
      onChange({ type, value })
      return
    }
    onChange(patchSelector({ relation: nextRelation }))
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <select
          value={type}
          onChange={(event) => onChange(patchSelector({ type: event.target.value as MaestroBuilderSelectorType }))}
          aria-label="Selector type"
          className={`${fieldClass} w-16 shrink-0`}
        >
          {supportedSelectors.map((option) => (
            <option key={option} value={option}>
              {SELECTOR_LABELS[option]}
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(event) => onChange(patchSelector({ value: event.target.value }))}
          placeholder={type === 'point' ? 'x,y' : type === 'id' ? 'resource_id' : 'Visible text or regex'}
          aria-label="Selector value"
          className={`${fieldClass} flex-1`}
        />
        {onPickElement && (
          <button
            type="button"
            onClick={onPickElement}
            title="Pick element on device"
            aria-label="Pick element on device"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 text-primary hover:bg-primary/10"
          >
            <Crosshair size={12} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        disabled={!hasPrimaryValue}
        className="flex w-fit items-center gap-1 text-[8px] font-semibold text-[var(--text-subtle)] hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={9} className={advancedOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
        Advanced · Relational selector
      </button>

      {advancedOpen && hasPrimaryValue && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-black/10 p-1.5">
          <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-[var(--text-subtle)]">Relation</span>
          <select
            value={relation ?? ''}
            onChange={(event) => updateRelation(event.target.value as MaestroSelectorRelation | '')}
            aria-label="Relation"
            className={`${fieldClass} w-28 shrink-0`}
          >
            <option value="">— none —</option>
            {RELATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {relation && (
            <>
              <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-[var(--text-subtle)]">Related element</span>
              <input
                value={relatedValue}
                onChange={(event) => onChange(patchSelector({ relatedValue: event.target.value }))}
                placeholder={type === 'id' ? 'resource_id' : 'Visible text'}
                aria-label="Related element"
                className={`${fieldClass} min-w-24 flex-1`}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
