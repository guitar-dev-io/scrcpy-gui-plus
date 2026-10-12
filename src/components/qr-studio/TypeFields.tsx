import type { QrFieldValues } from '../../types/qrStudio'
import { CheckField, Segmented, TextField } from './formControls'

interface TypeFieldsProps {
  fields: QrFieldValues
  /** Errors to display, keyed by field name (already filtered to touched fields). */
  errors: Record<string, string>
  onChange: (fields: QrFieldValues) => void
  onTouch: (key: string) => void
}

/** Per-type form. Which inputs show is decided by `fields.type`; encoders own the validation. */
export default function TypeFields({ fields, errors, onChange, onTouch }: TypeFieldsProps) {
  const text = (
    key: string,
    label: string,
    value: string,
    apply: (next: string) => QrFieldValues,
    extra: {
      type?: 'text' | 'datetime-local' | 'date' | 'tel' | 'email'
      multiline?: boolean
      rows?: number
      placeholder?: string
      mono?: boolean
      hint?: string
      inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url'
    } = {},
  ) => (
    <TextField
      key={key}
      label={label}
      value={value}
      error={errors[key]}
      onChange={(next) => {
        onTouch(key)
        onChange(apply(next))
      }}
      onBlur={() => onTouch(key)}
      {...extra}
    />
  )

  switch (fields.type) {
    case 'url':
      return text('url', 'URL', fields.url, (url) => ({ ...fields, url }), {
        placeholder: 'https://example.com',
        inputMode: 'url',
        hint: 'Only http and https addresses. A missing scheme becomes https://.',
      })
    case 'app-link':
      return text('url', 'App link URL', fields.url, (url) => ({ ...fields, url }), {
        placeholder: 'https://example.com/products/42',
        inputMode: 'url',
        hint: 'An https address that opens an app through Android App Links or universal links.',
      })
    case 'text':
      return text('text', 'Text', fields.text, (value) => ({ ...fields, text: value }), {
        multiline: true,
        rows: 4,
        placeholder: 'Text to encode',
      })
    case 'custom':
      return text('content', 'Content', fields.content, (content) => ({ ...fields, content }), {
        multiline: true,
        rows: 4,
        mono: true,
        placeholder: 'Raw content, encoded as typed',
      })
    case 'deep-link':
      return text('uri', 'Deep link URI', fields.uri, (uri) => ({ ...fields, uri }), {
        placeholder: 'myapp://screen/home?id=42',
        mono: true,
        inputMode: 'url',
      })
    case 'wifi':
      return (
        <div className="space-y-3">
          {text('ssid', 'Network name (SSID)', fields.ssid, (ssid) => ({ ...fields, ssid }))}
          <Segmented
            label="Security"
            value={fields.security}
            options={[
              { value: 'WPA', label: 'WPA/WPA2', title: 'WPA, WPA2 or WPA3 personal' },
              { value: 'WEP', label: 'WEP' },
              { value: 'nopass', label: 'None' },
            ]}
            onChange={(security) => {
              onTouch('password')
              onChange({ ...fields, security })
            }}
          />
          {fields.security !== 'nopass' &&
            text('password', 'Password', fields.password, (password) => ({ ...fields, password }))}
          <CheckField
            label="Hidden network"
            checked={fields.hidden}
            onChange={(hidden) => onChange({ ...fields, hidden })}
          />
        </div>
      )
    case 'contact':
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text('firstName', 'First name', fields.firstName, (firstName) => ({ ...fields, firstName }))}
          {text('lastName', 'Last name', fields.lastName, (lastName) => ({ ...fields, lastName }))}
          {text('phone', 'Phone', fields.phone, (phone) => ({ ...fields, phone }), { type: 'tel' })}
          {text('email', 'Email', fields.email, (email) => ({ ...fields, email }), { type: 'email' })}
          {text('org', 'Organization', fields.org, (org) => ({ ...fields, org }))}
          {text('url', 'Website', fields.url, (url) => ({ ...fields, url }), { inputMode: 'url' })}
        </div>
      )
    case 'email':
      return (
        <div className="space-y-3">
          {text('address', 'Email address', fields.address, (address) => ({ ...fields, address }), {
            type: 'email',
            placeholder: 'name@example.com',
          })}
          {text('subject', 'Subject', fields.subject, (subject) => ({ ...fields, subject }))}
          {text('body', 'Body', fields.body, (body) => ({ ...fields, body }), { multiline: true, rows: 3 })}
        </div>
      )
    case 'phone':
      return text('number', 'Phone number', fields.number, (number) => ({ ...fields, number }), {
        type: 'tel',
        placeholder: '+66 81 234 5678',
        hint: '3-20 digits. Spaces and dashes are removed.',
      })
    case 'sms':
      return (
        <div className="space-y-3">
          {text('number', 'Phone number', fields.number, (number) => ({ ...fields, number }), {
            type: 'tel',
            placeholder: '+66 81 234 5678',
          })}
          {text('message', 'Message', fields.message, (message) => ({ ...fields, message }), {
            multiline: true,
            rows: 3,
          })}
        </div>
      )
    case 'location':
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text('lat', 'Latitude', fields.lat, (lat) => ({ ...fields, lat }), {
            inputMode: 'decimal',
            placeholder: '13.7563',
          })}
          {text('lon', 'Longitude', fields.lon, (lon) => ({ ...fields, lon }), {
            inputMode: 'decimal',
            placeholder: '100.5018',
          })}
          <div className="sm:col-span-2">
            {text('label', 'Label (optional)', fields.label, (label) => ({ ...fields, label }))}
          </div>
        </div>
      )
    case 'event': {
      const pickerType = fields.allDay ? 'date' : 'datetime-local'
      const toggleAllDay = (allDay: boolean) => {
        const start = allDay ? fields.start.slice(0, 10) : fields.start.length === 10 ? `${fields.start}T09:00` : fields.start
        const end = allDay ? fields.end.slice(0, 10) : fields.end.length === 10 ? `${fields.end}T10:00` : fields.end
        onChange({ ...fields, allDay, start, end })
      }
      return (
        <div className="space-y-3">
          {text('title', 'Title', fields.title, (title) => ({ ...fields, title }))}
          <CheckField label="All day" checked={fields.allDay} onChange={toggleAllDay} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('start', 'Start', fields.start, (start) => ({ ...fields, start }), { type: pickerType })}
            {text('end', 'End', fields.end, (end) => ({ ...fields, end }), {
              type: pickerType,
              hint: fields.allDay ? 'The end date is exclusive: use the day after the last day.' : undefined,
            })}
          </div>
          {text('location', 'Location', fields.location, (location) => ({ ...fields, location }))}
          {text('description', 'Description', fields.description, (description) => ({ ...fields, description }), {
            multiline: true,
            rows: 3,
          })}
        </div>
      )
    }
  }
}
