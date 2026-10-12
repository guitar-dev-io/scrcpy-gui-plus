import { useId } from 'react'
import type { ReactNode } from 'react'
import { classNames } from '../ui/classNames'

export const panelClass =
  'rounded-xl border border-[#263244] bg-[linear-gradient(145deg,rgba(20,31,45,.98),rgba(13,22,34,.98))] shadow-[0_20px_60px_rgba(0,0,0,.2)]'
export const inputClass =
  'w-full rounded-lg border border-[#2a374a] bg-[#0c1624] px-3 py-2 text-[12px] text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#ff4f57]/70 focus:ring-2 focus:ring-[#ff4f57]/10 aria-[invalid=true]:border-red-400/70'
const buttonBase =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60 disabled:pointer-events-none disabled:opacity-40'
export const primaryButtonClass = `${buttonBase} bg-[linear-gradient(135deg,#ff625f,#f53f4c)] text-[color:var(--qr-text)] shadow-[0_8px_25px_rgba(255,67,76,.28)] hover:brightness-110`
export const secondaryButtonClass = `${buttonBase} border border-[#2a3749] bg-[#101b2a] text-slate-200 hover:border-[#ff4f57]/50 hover:text-[color:var(--qr-text)]`
export const outlineButtonClass = `${buttonBase} border border-[#ff4f57] text-[#ff7a80] hover:bg-[#ff4f57]/10`
export const labelClass = 'mb-1.5 block text-[11px] font-medium text-slate-300'

interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  type?: 'text' | 'datetime-local' | 'date' | 'number' | 'tel' | 'email' | 'password'
  multiline?: boolean
  rows?: number
  placeholder?: string
  maxLength?: number
  mono?: boolean
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url'
  onBlur?: () => void
  autoFocus?: boolean
}

/** Labeled input or textarea with an inline error linked through aria-describedby. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  multiline,
  rows = 3,
  placeholder,
  maxLength,
  mono,
  inputMode,
  onBlur,
  autoFocus,
}: TextFieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const describedBy = error || hint ? messageId : undefined
  const shared = {
    id,
    value,
    placeholder,
    maxLength,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    onBlur,
    autoFocus,
    className: classNames(inputClass, mono && 'font-mono'),
  } as const
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          rows={rows}
          className={classNames(shared.className, 'resize-y leading-relaxed')}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input {...shared} type={type} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? (
        <p id={messageId} className="mt-1 text-[11px] text-red-300">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1 text-[11px] text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; title?: string }>
  onChange: (value: T) => void
}

/** Radio-group segmented control (arrow keys move between options natively via radio inputs). */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId()
  return (
    <fieldset>
      <legend className={labelClass}>{label}</legend>
      <div className="flex rounded-lg border border-[#2a3749] bg-[#0d1725] p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            title={option.title}
            className={classNames(
              'flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-semibold transition focus-within:ring-2 focus-within:ring-[#ff4f57]/60',
              value === option.value ? 'bg-[#ff4f57] text-[color:var(--qr-text)]' : 'text-slate-400 hover:text-[color:var(--qr-text)]',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[11px] text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#ff4f57]"
      />
      {label}
    </label>
  )
}

export function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#2a3749] bg-[#0d1725] p-3">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--qr-text)]">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}
