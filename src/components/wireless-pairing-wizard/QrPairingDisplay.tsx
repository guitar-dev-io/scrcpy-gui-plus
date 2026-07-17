import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'

interface QrPairingDisplayProps {
  customPath?: string
  onPaired: (address: string) => void
  onError: (message: string) => void
}

interface QrData {
  serviceName: string
  password: string
  payload: string
  svg: string
}

type Status = 'generating' | 'waiting' | 'pairing' | 'success' | 'error'

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
}: QrPairingDisplayProps) {
  const { t } = useI18n()
  const [qrData, setQrData] = useState<QrData | null>(null)
  const [status, setStatus] = useState<Status>('generating')
  const [statusMessage, setStatusMessage] = useState('')
  const abortRef = useRef(false)
  const pollingRef = useRef(false)

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

  const handleRegenerate = () => {
    abortRef.current = true
    setTimeout(() => {
      void generateAndPoll()
    }, 100)
  }

  return (
    <div className="space-y-4">
      {/* QR Code Display */}
      {qrData && status !== 'generating' ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className="rounded-2xl border border-zinc-700 bg-[#09090b] p-3 shadow-lg"
            dangerouslySetInnerHTML={{ __html: qrData.svg }}
          />
          <p className="text-[9px] text-zinc-500 font-mono text-center max-w-[280px] break-all">
            {qrData.payload}
          </p>
        </div>
      ) : status === 'generating' ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={28} className="animate-spin text-primary" />
          <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
            {t('pairing.qrGenerating')}
          </span>
        </div>
      ) : null}

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
        {status === 'error' && (
          <span className="text-[10px] font-bold text-red-400">
            {statusMessage}
          </span>
        )}
      </div>

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
    </div>
  )
}
