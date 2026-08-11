import { Crosshair } from 'lucide-react'
import type { MaestroBuilderSelector, MaestroBuilderSelectorType } from '../../types/maestroBuilder'

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

const SELECTOR_LABELS: Record<MaestroBuilderSelectorType, string> = {
  id: 'ID',
  text: 'Text',
  index: 'Index',
  point: 'Point',
  css: 'CSS',
}

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

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <select
        value={type}
        onChange={(event) => onChange({ type: event.target.value as MaestroBuilderSelectorType, value })}
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
        onChange={(event) => onChange({ type, value: event.target.value })}
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
  )
}
