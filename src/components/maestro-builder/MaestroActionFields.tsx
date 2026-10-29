import type { ReactNode } from 'react'
import type { MaestroFieldDefinition, MaestroFieldValue } from '../../types/maestroBuilder'

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-base)] outline-none focus:border-primary/50'

interface MaestroActionFieldsProps {
  fields: MaestroFieldDefinition[]
  config: Record<string, MaestroFieldValue>
  onChange: (fieldName: string, value: MaestroFieldValue | undefined) => void
}

/** Keeps the field's name visible after it has a value (a placeholder disappears once you type). */
function Captioned({ field, className, children }: { field: MaestroFieldDefinition; className: string; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
      <span className="truncate text-[10px] text-[var(--text-subtle)]">
        {field.label}
        {field.optional && <span className="opacity-70"> · optional</span>}
      </span>
      {children}
    </label>
  )
}

export default function MaestroActionFields({ fields, config, onChange }: MaestroActionFieldsProps) {
  if (fields.length === 0) return null

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5">
      {fields.map((field) => {
        const value = config[field.name]
        if (field.type === 'boolean') {
          return (
            <label key={field.name} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-muted)]">
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
            <Captioned key={field.name} field={field} className="shrink-0">
              <select
                value={value === undefined ? '' : String(value)}
                onChange={(event) => onChange(field.name, event.target.value)}
                aria-label={field.label}
                className={fieldClass}
              >
                {field.optional && <option value="">—</option>}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Captioned>
          )
        }
        if (field.type === 'number') {
          return (
            <Captioned key={field.name} field={field} className="w-24 shrink-0">
              <input
                type="number"
                value={value === undefined ? '' : String(value)}
                min={field.min}
                max={field.max}
                placeholder={field.placeholder ?? field.label}
                onChange={(event) =>
                  onChange(field.name, event.target.value === '' ? undefined : Number(event.target.value))
                }
                aria-label={field.label}
                className={`${fieldClass} w-full`}
              />
            </Captioned>
          )
        }
        return (
          <Captioned key={field.name} field={field} className="min-w-28 flex-1">
            <input
              value={value === undefined ? '' : String(value)}
              placeholder={field.placeholder ?? field.label}
              onChange={(event) => onChange(field.name, event.target.value)}
              aria-label={field.label}
              className={`${fieldClass} w-full`}
            />
          </Captioned>
        )
      })}
    </div>
  )
}
