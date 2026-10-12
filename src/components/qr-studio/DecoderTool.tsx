import { friendlyMessage } from '../../services/tauriRuntime'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { ImageUp, Loader2 } from 'lucide-react'
import { decodeQrImage } from '../../services/qrDeviceService'
import type { QrDecodeResult } from '../../types/qrDevice'
import type { QrFieldValues } from '../../types/qrStudio'
import { isTauri } from '../../utils/tauriEnv'
import { DecodedList } from './DeviceParts'
import { decodedFields, decodedRecordInput } from './deviceTargets'
import { secondaryButtonClass } from './formControls'
import { blobToBase64 } from './qrDownloads'
import type { UseQrStore } from './useQrStore'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg']
export const UNSUPPORTED_IMAGE_MESSAGE = 'Unsupported image type. Only PNG and JPEG images can be read. WebP and GIF are not supported.'
export const TOO_LARGE_MESSAGE = 'This image is larger than 10 MB. Choose a smaller image.'
export const NOT_DECODABLE_MESSAGE = 'No QR code could be read from this image.'

interface DecoderToolProps {
  store: UseQrStore
  onUseInCreate: (fields: QrFieldValues) => void
  onStatus: (message: string) => void
}

function decodeFailure(result: QrDecodeResult): string {
  switch (result.errorCode) {
    case 'unsupported_format':
      return UNSUPPORTED_IMAGE_MESSAGE
    case 'too_large':
      return TOO_LARGE_MESSAGE
    case 'no_qr_found':
    case 'decode_failed':
      return NOT_DECODABLE_MESSAGE
    default:
      return result.error?.trim() || NOT_DECODABLE_MESSAGE
  }
}

export default function DecoderTool({ store, onUseInCreate, onStatus }: DecoderToolProps) {
  const desktop = isTauri()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [texts, setTexts] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const request = useRef(0)

  const decodeFile = async (file: File) => {
    const id = ++request.current
    setError(null)
    setTexts([])
    setSaveNote(null)
    setFileName(file.name)
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError(UNSUPPORTED_IMAGE_MESSAGE)
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(TOO_LARGE_MESSAGE)
      return
    }
    setBusy(true)
    try {
      const result = await decodeQrImage(await blobToBase64(file))
      if (request.current !== id) return
      if (result.success && result.texts.length > 0) setTexts(result.texts)
      else setError(decodeFailure(result))
    } catch (reason) {
      if (request.current !== id) return
      console.error('QR Studio: image decode failed', reason)
      setError(friendlyMessage(reason, 'The image could not be decoded.'))
    } finally {
      if (request.current === id) setBusy(false)
    }
  }

  const decodeRef = useRef(decodeFile)
  decodeRef.current = decodeFile

  useEffect(() => {
    if (!desktop) return
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith('image/'))
      if (!file) return
      event.preventDefault()
      void decodeRef.current(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [desktop])

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!desktop) return
    const file = event.dataTransfer.files[0]
    if (file) void decodeFile(file)
  }

  const save = (text: string) => {
    const result = store.saveRecord(decodedRecordInput(text))
    setSaveNote(result.ok ? 'Saved to the library as a decoded code' : result.error)
    if (result.ok) onStatus('Saved to the library')
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">
        Read QR codes from a PNG or JPEG image (up to 10 MB). Choose a file, drop one here, or paste an image.
      </p>
      <div
        data-testid="decoder-dropzone"
        onDragOver={(event) => {
          event.preventDefault()
          if (desktop) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center ${
          dragging ? 'border-[#ff4f57] bg-[#ff4f57]/10' : 'border-[#2a3749] bg-[#0c1624]'
        }`}
      >
        <ImageUp size={22} className="text-slate-400" aria-hidden="true" />
        <label className={`${secondaryButtonClass} cursor-pointer ${desktop ? '' : 'pointer-events-none opacity-40'}`}>
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={!desktop}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void decodeFile(file)
            }}
          />
        </label>
        {!desktop && <p className="text-[11px] text-slate-400">Requires the desktop app</p>}
        {fileName && <p className="max-w-full truncate text-[11px] text-slate-500">{fileName}</p>}
      </div>
      <div role="status" className="min-h-4 text-[11px]">
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Reading image…
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-red-300">
          {error}
        </p>
      )}
      {texts.length > 0 && (
        <DecodedList
          texts={texts}
          onStatus={onStatus}
          onSave={save}
          onUseInCreate={(text) => onUseInCreate(decodedFields(text))}
        />
      )}
      {saveNote && (
        <p role="status" className="text-[11px] text-slate-300">
          {saveNote}
        </p>
      )}
    </div>
  )
}
