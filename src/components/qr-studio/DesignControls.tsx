import { useEffect, useId, useState } from 'react'
import { Palette } from 'lucide-react'
import { DEFAULT_QR_STYLE, type QrErrorCorrection, type QrStyle, type QrTemplate } from '../../types/qrStudio'
import { Select } from '../ui'
import { MIN_SIZE_PX } from '../../services/qrQuality'
import { Section, Segmented, inputClass, labelClass } from './formControls'

const HEX = /^#[0-9a-fA-F]{6}$/

export const MAX_SIZE_PX = 4096

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_QR_STYLE.size
  return Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, Math.round(value)))
}

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  const id = useId()
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const invalid = !HEX.test(text)
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-[#2a3749] bg-transparent p-0.5"
        />
        <input
          id={id}
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            if (HEX.test(next)) onChange(next)
          }}
          onBlur={() => setText(value)}
          className={`${inputClass} font-mono`}
        />
      </div>
      {invalid && <p className="mt-1 text-[11px] text-red-300">Use a 6-digit hex value like #111827</p>}
    </div>
  )
}

const EC_OPTIONS: ReadonlyArray<{ value: QrErrorCorrection; label: string; title: string }> = [
  { value: 'L', label: 'L', title: 'Low: about 7% recoverable' },
  { value: 'M', label: 'M', title: 'Medium: about 15% recoverable' },
  { value: 'Q', label: 'Q', title: 'Quartile: about 25% recoverable' },
  { value: 'H', label: 'H', title: 'High: about 30% recoverable' },
]

interface DesignControlsProps {
  style: QrStyle
  templates: readonly QrTemplate[]
  onChange: (style: QrStyle) => void
}

export default function DesignControls({ style, templates, onChange }: DesignControlsProps) {
  const sizeId = useId()
  const [sizeText, setSizeText] = useState(String(style.size))
  useEffect(() => setSizeText(String(style.size)), [style.size])

  return (
    <Section title="Design" icon={<Palette size={13} className="text-[#ff4f57]" aria-hidden="true" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ColorField label="Foreground" value={style.foreground} onChange={(foreground) => onChange({ ...style, foreground })} />
        <ColorField label="Background" value={style.background} onChange={(background) => onChange({ ...style, background })} />
        <Segmented
          label="Error correction"
          value={style.errorCorrection}
          options={EC_OPTIONS}
          onChange={(errorCorrection) => onChange({ ...style, errorCorrection })}
        />
        <div>
          <label htmlFor={sizeId} className={labelClass}>
            Export size (px)
          </label>
          <input
            id={sizeId}
            type="number"
            inputMode="numeric"
            min={MIN_SIZE_PX}
            max={MAX_SIZE_PX}
            step={1}
            value={sizeText}
            onChange={(event) => {
              setSizeText(event.target.value)
              const parsed = Number(event.target.value)
              if (Number.isInteger(parsed) && parsed >= MIN_SIZE_PX && parsed <= MAX_SIZE_PX) {
                onChange({ ...style, size: parsed })
              }
            }}
            onBlur={() => {
              const size = clampSize(Number(sizeText))
              setSizeText(String(size))
              if (size !== style.size) onChange({ ...style, size })
            }}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {MIN_SIZE_PX} to {MAX_SIZE_PX}
          </p>
        </div>
        <div className="sm:col-span-2">
          <span className={labelClass}>Template</span>
          <Select
            aria-label="Apply template"
            placeholder="Apply template…"
            value=""
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            onChange={(id) => {
              const template = templates.find((item) => item.id === id)
              if (template) onChange({ ...style, ...template.style })
            }}
            className="w-full"
          />
        </div>
      </div>
    </Section>
  )
}
