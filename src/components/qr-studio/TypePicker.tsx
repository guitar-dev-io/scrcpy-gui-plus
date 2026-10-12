import type { QrContentType } from '../../types/qrStudio'
import { Select } from '../ui'
import { labelClass } from './formControls'

export const QR_TYPE_OPTIONS: ReadonlyArray<{
  value: QrContentType
  label: string
}> = [
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'contact', label: 'Contact (vCard)' },
  { value: 'deep-link', label: 'Deep Link' },
  { value: 'app-link', label: 'App Link' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'sms', label: 'SMS' },
  { value: 'location', label: 'Location' },
  { value: 'event', label: 'Event' },
  { value: 'custom', label: 'Custom' },
]

interface TypePickerProps {
  value: QrContentType
  onChange: (type: QrContentType) => void
}

export default function TypePicker({ value, onChange }: TypePickerProps) {
  return (
    <div>
      <span className={labelClass}>Type</span>
      <Select
        aria-label="Type"
        value={value}
        options={QR_TYPE_OPTIONS.map((option) => ({ ...option }))}
        onChange={(next) => onChange(next as QrContentType)}
        className="w-full"
      />
    </div>
  )
}
