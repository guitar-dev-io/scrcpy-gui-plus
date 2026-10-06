import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'

interface QrPairingDisplayProps {
  customPath?: string
  onPaired: (address: string) => void
  onError: (message: string) => void
  /** Reports every status/message transition, for callers that surface it elsewhere (e.g. a status card). */
  onStatusChange?: (status: QrPairingStatus, message: string) => void
  /** Hides the built-in instructions list and regenerate button so a caller can render its own in a different layout slot. */
  compact?: boolean
  /** Increment to force a fresh QR code (e.g. from an external "Refresh QR" button). */
  regenerateSignal?: number
}

interface QrData {
  serviceName: string
  password: string
  payload: string
  svg: string
}

export type QrPairingStatus = 'generating' | 'waiting' | 'pairing' | 'success' | 'error'
type Status = QrPairingStatus

/**
 * Displays a QR code on screen for the phone to scan.
 *
 * Flow:
 * 1. Calls generate_pairing_qr (Rust) to get a random service name + password + SVG
 * 2. Displays the QR code SVG on screen
 * 3. Calls poll_qr_pairing (Rust) which polls `adb mdns services` looking for the phone
 * 4. When the phone scans the QR and advertises its pairing service, Rust auto-pairs
 * 5. On success, notifies the frontend
 *
 * The phone must be on the same WiFi and have "Pair device with QR code" open.
 */
export default function QrPairingDisplay({
  customPath,
  onPaired,
  onError,
  onStatusChange,
  compact = false,
  regenerateSignal,
}: QrPairingDisplayProps) {
  const { t } = useI18n()
  const [qrData, setQrData] = useState<QrData | null>(null)
  const [status, setStatus] = useState<Status>('generating')
  const [statusMessage, setStatusMessage] = useState('')
  const abortRef = useRef(false)
  const pollingRef = useRef(false)
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  })
  useEffect(() => {
    onStatusChangeRef.current?.(status, statusMessage)
  }, [status, statusMessage])

  // Keep the latest callbacks/props in refs so generateAndPoll stays stable and
  // the effect below only runs once on mount (avoids a re-render loop that would
  // regenerate the QR code on every render and make the UI flicker).
  const onPairedRef = useRef(onPaired)
  const onErrorRef = useRef(onError)
  const customPathRef = useRef(customPath)
  const tRef = useRef(t)
  useEffect(() => {
    onPairedRef.current = onPaired
    onErrorRef.current = onError
    customPathRef.current = customPath
    tRef.current = t
  })

  const generateAndPoll = useCallback(async () => {
    abortRef.current = false
    setStatus('generating')
    setStatusMessage('')

    const customPath = customPathRef.current
    const tr = tRef.current

    try {
      // Step 1: Generate QR data
      const res: any = await invoke('generate_pairing_qr', { customPath })
      if (!res.success) {
        setStatus('error')
        setStatusMessage(res.message || 'Failed to generate QR')
        return
      }

      const data: QrData = {
        serviceName: res.serviceName,
        password: res.password,
        payload: res.payload,
        svg: res.svg,
      }
      setQrData(data)
      setStatus('waiting')

      if (abortRef.current) return

      // Step 2: Start polling for the phone
      pollingRef.current = true
      setStatusMessage(tr('pairing.qrWaitingForPhone'))

      const pollRes: any = await invoke('poll_qr_pairing', {
        serviceName: data.serviceName,
        password: data.password,
        customPath,
      })

      pollingRef.current = false
      if (abortRef.current) return

      if (pollRes.success) {
        setStatus('success')
        const addr = pollRes.address || ''
        setStatusMessage(
          pollRes.connected
            ? tr('pairing.qrPairedAndConnected', { address: addr })
            : tr('pairing.qrPairedNotConnected', { address: addr }),
        )
        onPairedRef.current(addr)
      } else {
        setStatus('error')
        setStatusMessage(pollRes.message || 'Pairing failed')
        onErrorRef.current(pollRes.message || 'Pairing failed')
      }
    } catch (e: any) {
      if (!abortRef.current) {
        setStatus('error')
        setStatusMessage(String(e))
        onErrorRef.current(String(e))
      }
    }
  }, [])

  useEffect(() => {
    void generateAndPoll()
    return () => {
      abortRef.current = true
    }
  }, [generateAndPoll])

  const handleRegenerate = useCallback(() => {
    abortRef.current = true
    setTimeout(() => {
      void generateAndPoll()
    }, 100)
  }, [generateAndPoll])

  // Signal-driven regenerate for an external "Refresh QR" button. Skips the
  // initial mount value so it only fires on subsequent increments.
  const regenerateSignalRef = useRef(regenerateSignal)
  useEffect(() => {
    if (regenerateSignal === undefined) return
    if (regenerateSignalRef.current === regenerateSignal) return
    regenerateSignalRef.current = regenerateSignal
    handleRegenerate()
  }, [regenerateSignal, handleRegenerate])

  const qrBoxSize = compact ? 260 : 220

  return (
    <div className="space-y-4">
      {/* QR Code Display: always a fixed-size bordered box, whatever the state,
          so a failed/pending fetch never collapses into bare floating text. */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex items-center justify-center rounded-2xl border border-zinc-700 bg-[#09090b] p-4 shadow-lg"
          style={{ width: qrBoxSize, height: qrBoxSize }}
        >
          {qrData && status !== 'generating' ? (
            <div
              className="[&_svg]:h-full [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrData.svg }}
            />
          ) : status === 'error' ? (
            <div className="flex flex-col items-center gap-2 px-2 text-center">
              <AlertTriangle size={26} className="text-red-400" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">
                Couldn&apos;t generate QR
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                {t('pairing.qrGenerating')}
              </span>
            </div>
          )}
        </div>
        {qrData && status !== 'generating' && (
          <p className="max-w-[280px] break-all text-center font-mono text-[9px] text-zinc-500">
            {qrData.payload}
          </p>
        )}
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2">
        {status === 'waiting' && (
          <>
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </div>
            <span className="text-[10px] font-bold text-zinc-300">
              {statusMessage || t('pairing.qrWaitingForPhone')}
            </span>
          </>
        )}
        {status === 'pairing' && (
          <>
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-[10px] font-bold text-zinc-300">
              {t('pairing.qrPairingInProgress')}
            </span>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={14} className="text-emerald-400" />
            <span className="text-[10px] font-bold text-emerald-400">
              {statusMessage}
            </span>
          </>
        )}
        {status === 'error' && !compact && (
          <span className="text-[10px] font-bold text-red-400">
            {statusMessage}
          </span>
        )}
      </div>

      {!compact && (
        <>
          {/* Instructions */}
          <div className="bg-zinc-950/60 border border-zinc-800/50 rounded-lg p-3 space-y-1">
            <p className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
              {t('pairing.qrInstructions')}
            </p>
            <ol className="text-[10px] text-zinc-400 space-y-0.5 list-decimal list-inside">
              <li>{t('pairing.qrStep1')}</li>
              <li>{t('pairing.qrStep2')}</li>
              <li>{t('pairing.qrStep3')}</li>
            </ol>
          </div>

          {/* Regenerate button */}
          {(status === 'error' || status === 'success') && (
            <button
              onClick={handleRegenerate}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-800 bg-zinc-950/40 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <RefreshCw size={12} />
              {t('pairing.qrRegenerate')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
