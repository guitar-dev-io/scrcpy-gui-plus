import type { MaestroFieldDefinition, MaestroFieldValue } from '../../types/maestroBuilder'

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

interface MaestroActionFieldsProps {
  fields: MaestroFieldDefinition[]
  config: Record<string, MaestroFieldValue>
  onChange: (fieldName: string, value: MaestroFieldValue | undefined) => void
}

export default function MaestroActionFields({ fields, config, onChange }: MaestroActionFieldsProps) {
  if (fields.length === 0) return null

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {fields.map((field) => {
        const value = config[field.name]
        if (field.type === 'boolean') {
          return (
            <label key={field.name} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => onChange(field.name, event.target.checked)}
              />
              {field.label}
            </label>
          )
        }
        if (field.type === 'select') {
          return (
            <select
              key={field.name}
              value={value === undefined ? '' : String(value)}
              onChange={(event) => onChange(field.name, event.target.value)}
              aria-label={field.label}
              className={`${fieldClass} shrink-0`}
            >
              {field.optional && <option value="">—</option>}
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        }
        if (field.type === 'number') {
          return (
            <input
              key={field.name}
              type="number"
              value={value === undefined ? '' : String(value)}
              min={field.min}
              max={field.max}
              placeholder={field.placeholder ?? field.label}
              onChange={(event) =>
                onChange(field.name, event.target.value === '' ? undefined : Number(event.target.value))
              }
              aria-label={field.label}
              className={`${fieldClass} w-20 shrink-0`}
            />
          )
        }
        return (
          <input
            key={field.name}
            value={value === undefined ? '' : String(value)}
            placeholder={field.placeholder ?? field.label}
            onChange={(event) => onChange(field.name, event.target.value)}
            aria-label={field.label}
            className={`${fieldClass} min-w-24 flex-1`}
          />
        )
      })}
    </div>
  )
}
