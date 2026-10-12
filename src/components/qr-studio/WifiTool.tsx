import { useMemo, useState } from 'react'
import { Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { encode } from '../../services/qrEncoders'
import { DEFAULT_QR_STYLE, type QrFieldValues, type QrWifiSecurity } from '../../types/qrStudio'
import LivePreview, { useQrPreview } from './LivePreview'
import { CheckField, Segmented, TextField, primaryButtonClass, secondaryButtonClass } from './formControls'
import type { UseQrStore } from './useQrStore'

export const WIFI_WARNING = 'The password is embedded in the QR and visible to anyone who scans it'

interface WifiToolProps {
  store: UseQrStore
  onUseInCreate: (fields: QrFieldValues) => void
  onStatus: (message: string) => void
}

const SECURITY_OPTIONS: Array<{ value: QrWifiSecurity; label: string }> = [
  { value: 'WPA', label: 'WPA/WPA2' },
  { value: 'WEP', label: 'WEP' },
  { value: 'nopass', label: 'None' },
]

/**
 * Standalone Wi-Fi generator. The form lives in memory only: the password reaches storage solely
 * when the user saves a record.
 */
export default function WifiTool({ store, onUseInCreate, onStatus }: WifiToolProps) {
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [security, setSecurity] = useState<QrWifiSecurity>('WPA')
  const [hidden, setHidden] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fields: QrFieldValues = useMemo(
    () => ({ type: 'wifi', ssid, password: security === 'nopass' ? '' : password, security, hidden }),
    [ssid, password, security, hidden],
  )
  const encoded = useMemo(() => encode(fields), [fields])
  const content = encoded.ok ? encoded.content : null
  const preview = useQrPreview(content, DEFAULT_QR_STYLE.errorCorrection)
  const errors = encoded.ok ? {} : encoded.errors

  const save = () => {
    if (content === null) return
    const result = store.saveRecord({
      name: ssid.trim() ? `Wi-Fi ${ssid.trim()}` : 'Wi-Fi',
      content,
      contentType: 'wifi',
      style: { ...DEFAULT_QR_STYLE },
      fields,
      source: 'created',
    })
    if (result.ok) {
      setSaveError(null)
      onStatus('Wi-Fi QR code saved')
    } else {
      setSaveError(result.error)
    }
  }

  return (
    <div className="space-y-4">
      <p
        role="note"
        className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[.07] px-3 py-2 text-[11px] text-amber-300"
      >
        <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {WIFI_WARNING}
      </p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
        <div className="space-y-3">
          <TextField label="Network name (SSID)" value={ssid} onChange={setSsid} error={ssid ? errors.ssid : undefined} maxLength={32} />
          <Segmented label="Security" value={security} options={SECURITY_OPTIONS} onChange={setSecurity} />
          {security !== 'nopass' && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  error={password ? errors.password : undefined}
                />
              </div>
              <button
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className={`${secondaryButtonClass} h-9 w-9 shrink-0 px-0`}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              </button>
            </div>
          )}
          <CheckField label="Hidden network" checked={hidden} onChange={setHidden} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButtonClass} disabled={content === null} onClick={() => onUseInCreate(fields)}>
              Use in Create
            </button>
            <button type="button" className={secondaryButtonClass} disabled={content === null} onClick={save}>
              Save to library
            </button>
          </div>
          {saveError && (
            <p role="alert" className="text-[11px] text-red-300">
              {saveError}
            </p>
          )}
        </div>
        <LivePreview style={DEFAULT_QR_STYLE} preview={preview} hasContent={content !== null} />
      </div>
    </div>
  )
}
