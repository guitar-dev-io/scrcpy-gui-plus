import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSimDeckStatus,
  simulatorWebrtcOffer,
} from '../services/simDeckService'

export type SimulatorStreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'error'

const ICE_GATHERING_TIMEOUT_MS = 1_500
const STREAM_CONNECT_TIMEOUT_MS = 12_000

export function isWebrtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
}

function randomClientId(): string {
  return `scrcpy-gui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    const timer = window.setTimeout(finish, ICE_GATHERING_TIMEOUT_MS)
  })
}

/** Live simulator video over the same WebRTC offer/answer flow as SimDeck. */
export function useSimulatorStream(customPath?: string) {
  const [status, setStatus] = useState<SimulatorStreamStatus>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const generationRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)
  const disconnectGraceRef = useRef<number | null>(null)

  const clearConnectTimeout = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const clearDisconnectGrace = useCallback(() => {
    if (disconnectGraceRef.current !== null)
      window.clearTimeout(disconnectGraceRef.current)
    disconnectGraceRef.current = null
  }, [])

  const disconnect = useCallback(() => {
    generationRef.current += 1
    clearConnectTimeout()
    clearDisconnectGrace()
    pcRef.current?.close()
    pcRef.current = null
    setStream(null)
    setStatus('idle')
    setErrorMessage('')
  }, [clearConnectTimeout, clearDisconnectGrace])

  const connect = useCallback(
    async (udid: string) => {
      generationRef.current += 1
      const generation = generationRef.current
      clearConnectTimeout()
      clearDisconnectGrace()
      pcRef.current?.close()
      pcRef.current = null
      setStream(null)
      setStatus('connecting')
      setErrorMessage('')

      if (!isWebrtcSupported()) {
        setStatus('error')
        setErrorMessage('WebRTC is not supported in this environment.')
        return
      }

      try {
        const daemonStatus = await getSimDeckStatus(customPath)
        if (generation !== generationRef.current) return
        if (!daemonStatus.running)
          throw new Error(
            daemonStatus.error || 'SimDeck service is not running',
          )

        const pc = new RTCPeerConnection({
          iceServers: daemonStatus.iceServers ?? [],
        })
        pcRef.current = pc
        pc.addTransceiver('video', { direction: 'recvonly' })

        timeoutRef.current = window.setTimeout(() => {
          if (generation !== generationRef.current || pcRef.current !== pc)
            return
          pc.close()
          pcRef.current = null
          setStream(null)
          setStatus('error')
          setErrorMessage('Timed out waiting for the SimDeck video stream.')
        }, STREAM_CONNECT_TIMEOUT_MS)

        pc.addEventListener('track', (event) => {
          if (generation !== generationRef.current) return
          clearConnectTimeout()
          setStream(event.streams[0] ?? new MediaStream([event.track]))
          setStatus('streaming')
        })
        pc.addEventListener('connectionstatechange', () => {
          if (generation !== generationRef.current) return
          if (pc.connectionState === 'connected') {
            clearDisconnectGrace()
            return
          }
          if (pc.connectionState === 'disconnected') {
            clearDisconnectGrace()
            disconnectGraceRef.current = window.setTimeout(() => {
              if (
                generation !== generationRef.current ||
                pc.connectionState !== 'disconnected'
              )
                return
              pc.close()
              pcRef.current = null
              setStream(null)
              setStatus('error')
              setErrorMessage('WebRTC connection disconnected.')
            }, 3_000)
            return
          }
          if (pc.connectionState === 'failed') {
            clearConnectTimeout()
            clearDisconnectGrace()
            pc.close()
            pcRef.current = null
            setStream(null)
            setStatus('error')
            setErrorMessage('WebRTC connection failed.')
          }
        })

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await waitForIceGathering(pc)
        if (generation !== generationRef.current) return

        const localSdp = pc.localDescription?.sdp
        if (!localSdp) throw new Error('Failed to create local WebRTC offer')
        const answer = await simulatorWebrtcOffer(
          udid,
          localSdp,
          randomClientId(),
          customPath,
        )
        if (generation !== generationRef.current) return
        if (!answer.sdp)
          throw new Error('SimDeck returned an empty WebRTC answer')
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
      } catch (error) {
        if (generation !== generationRef.current) return
        console.error('simulator webrtc connect failed', error)
        clearConnectTimeout()
        clearDisconnectGrace()
        pcRef.current?.close()
        pcRef.current = null
        setStream(null)
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [clearConnectTimeout, clearDisconnectGrace, customPath],
  )

  useEffect(() => () => disconnect(), [disconnect])

  return { status, stream, errorMessage, connect, disconnect }
}
