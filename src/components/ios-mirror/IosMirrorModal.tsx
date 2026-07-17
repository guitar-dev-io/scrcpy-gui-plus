import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { X, MonitorSmartphone, Loader2, AlertTriangle } from 'lucide-react'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'

interface IosMirrorModalProps {
  isOpen: boolean
  onClose: () => void
  device: IosDeviceInfo | null
  customPath?: string
}

/**
 * Live (view-only) iOS mirror surface. On open it starts the pymobiledevice3
 * frame streamer in the backend and renders each incoming PNG frame (delivered
 * as a base64 data URL via the `ios-frame` event) into an <img>. Frame rate is
 * hardware-limited by the iOS debug interface (~2-15 fps).
 */
export default function IosMirrorModal({
  isOpen,
  onClose,
  device,
  customPath,
}: IosMirrorModalProps) {
  const [frame, setFrame] = useState<string>('')
  const [fps, setFps] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'streaming' | 'error'>(
    'connecting',
  )
  const [errorMsg, setErrorMsg] = useState('')
  const frameTimes = useRef<number[]>([])
  const udid = device?.udid ?? ''

  useEffect(() => {
    if (!isOpen || !udid) return

    let disposed = false
    setFrame('')
    setFps(0)
    setStatus('connecting')
    setErrorMsg('')
    frameTimes.current = []

    const unlistenFrame = listen<{ udid: string; seq: number; data: string }>(
      'ios-frame',
      (event) => {
        if (disposed || event.payload.udid !== udid) return
        setFrame(event.payload.data)
        setStatus('streaming')
        // Rolling FPS over the last second.
        const now = performance.now()
        frameTimes.current.push(now)
        frameTimes.current = frameTimes.current.filter((t) => now - t <= 1000)
        setFps(frameTimes.current.length)
      },
    )

    const unlistenStatus = listen<{ udid: string; running: boolean }>(
      'ios-status',
      (event) => {
        if (disposed || event.payload.udid !== udid) return
        if (!event.payload.running) {
          setStatus((prev) => (prev === 'streaming' ? 'streaming' : 'error'))
        }
      },
    )

    ;(async () => {
      try {
        const res = await invoke<{ success: boolean; message: string }>(
          'start_ios_mirror',
          { udid, customPath },
        )
        if (!res.success && !disposed) {
          setStatus('error')
          setErrorMsg(res.message)
        }
      } catch (e) {
        if (!disposed) {
          setStatus('error')
          setErrorMsg(String(e))
        }
      }
    })()

    return () => {
      disposed = true
      unlistenFrame.then((f) => f())
      unlistenStatus.then((f) => f())
      void invoke('stop_ios_mirror', { udid }).catch(() => {})
    }
  }, [isOpen, udid, customPath])

  if (!isOpen || !device) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="glass w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-md overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/60">
          <MonitorSmartphone size={16} className="text-primary" />
          <div className="min-w-0">
            <h2 className="text-[12px] font-black uppercase tracking-widest text-zinc-200 truncate">
              {device.name}
            </h2>
            <p className="text-[9px] font-bold uppercase tracking-tighter text-zinc-500">
              iOS {device.productVersion} · view-only ·{' '}
              {status === 'streaming' ? `${fps} fps` : status}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center p-4 overflow-auto bg-black/40 min-h-[320px]">
          {status === 'error' ? (
            <div className="flex flex-col items-center gap-2 text-center max-w-md">
              <AlertTriangle size={28} className="text-amber-500" />
              <p className="text-[11px] font-bold text-zinc-300">
                Mirror stopped
              </p>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                {errorMsg ||
                  'The stream ended. Make sure the device is unlocked, trusted, and Developer Mode is enabled.'}
              </p>
            </div>
          ) : frame ? (
            <img
              src={frame}
              alt="iOS screen"
              className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-2xl"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-zinc-500">
              <Loader2 size={28} className="animate-spin text-primary" />
              <p className="text-[10px] font-bold uppercase tracking-widest">
                Connecting to device...
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-2 border-t border-zinc-800/60">
          <p className="text-[9px] text-zinc-600 leading-relaxed">
            View-only. Frame rate is limited by the iOS debug interface. Touch
            control requires WebDriverAgent (not enabled).
          </p>
        </div>
      </div>
    </div>
  )
}
