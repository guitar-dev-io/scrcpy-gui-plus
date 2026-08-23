import { useCallback, useEffect, useRef, useState } from 'react'
import { Channel } from '@tauri-apps/api/core'
import { isTauri } from '../utils/tauriEnv'
import {
  disconnectCompanion,
  onCompanionRemoteStatus,
  onCompanionScreenStatus,
  onCompanionStatus,
  requestCompanion,
  scanCompanionDevices,
  startCompanionLanPairing,
  startCompanionRemote,
  startCompanionScreen,
  stopCompanionScreen,
  stopCompanionRemote,
} from '../services/companionService'
import {
  CompanionOperationError,
  type CompanionDevice,
  type CompanionLanOffer,
  type CompanionMethod,
  type CompanionParams,
  type CompanionRemoteStartResult,
  type CompanionRemotePermission,
  type CompanionRemoteStatusEvent,
  type CompanionScreenState,
  type CompanionScreenStatusEvent,
  type CompanionStatusEvent,
} from '../types/companion'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    )
  }
  return btoa(binary)
}

export function useCompanion() {
  const [devices, setDevices] = useState<CompanionDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isPairing, setIsPairing] = useState(false)
  const [lanOffer, setLanOffer] = useState<CompanionLanOffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<CompanionStatusEvent | null>(null)
  const [screenStatus, setScreenStatus] =
    useState<CompanionScreenStatusEvent | null>(null)
  const [screenFrame, setScreenFrame] = useState<string | null>(null)
  const [screenState, setScreenState] =
    useState<CompanionScreenState>('stopped')
  const [isScreenStarting, setIsScreenStarting] = useState(false)
  const [isScreenStreaming, setIsScreenStreaming] = useState(false)
  const [remoteStatus, setRemoteStatus] =
    useState<CompanionRemoteStatusEvent | null>(null)
  const [isRemoteStarting, setIsRemoteStarting] = useState(false)
  const [isRemoteActive, setIsRemoteActive] = useState(false)
  const scanGenerationRef = useRef(0)
  const pairingGenerationRef = useRef(0)
  const backendPairingGenerationRef = useRef(0)
  const sessionGenerationRef = useRef(0)
  const screenGenerationRef = useRef(0)
  const screenOperationRef = useRef(0)
  const screenFrameUrlRef = useRef<string | null>(null)
  const latestScreenFrameRef = useRef<Uint8Array | null>(null)
  const remoteGenerationRef = useRef(0)
  const remoteOperationRef = useRef(0)
  const remoteEventsBlockedRef = useRef(false)

  const applyRemoteStatus = useCallback(
    (payload: CompanionRemoteStatusEvent) => {
      if (remoteEventsBlockedRef.current) return
      if (payload.generation < remoteGenerationRef.current) return
      remoteGenerationRef.current = payload.generation
      setRemoteStatus((current) => ({
        ...payload,
        targetSerial: payload.targetSerial ?? current?.targetSerial,
        sessionId: payload.sessionId ?? current?.sessionId,
        permissions: payload.permissions ?? current?.permissions,
        videoReady: payload.videoReady ?? current?.videoReady,
        embeddedAutoStarted:
          payload.embeddedAutoStarted ?? current?.embeddedAutoStarted,
      }))
      setIsRemoteStarting(
        payload.stage === 'pending_approval' ||
          payload.stage === 'starting' ||
          payload.stage === 'preparing_target' ||
          payload.stage === 'connecting',
      )
      setIsRemoteActive(
        payload.stage === 'active' ||
          payload.stage === 'connected' ||
          payload.stage === 'reconnecting',
      )
    },
    [],
  )

  const resetRemoteState = useCallback(() => {
    remoteOperationRef.current += 1
    remoteGenerationRef.current += 1
    remoteEventsBlockedRef.current = true
    setRemoteStatus(null)
    setIsRemoteStarting(false)
    setIsRemoteActive(false)
  }, [])

  const updateScreenState = useCallback((nextState: CompanionScreenState) => {
    setScreenState(nextState)
    setIsScreenStarting(
      nextState === 'connecting' ||
        nextState === 'waiting_permission' ||
        nextState === 'reconnecting',
    )
    setIsScreenStreaming(nextState === 'streaming')
  }, [])

  const clearScreenFrame = useCallback(() => {
    const previousUrl = screenFrameUrlRef.current
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    screenFrameUrlRef.current = null
    latestScreenFrameRef.current = null
    setScreenFrame(null)
  }, [])

  const resetScreenState = useCallback(() => {
    screenOperationRef.current += 1
    screenGenerationRef.current += 1
    setScreenStatus(null)
    updateScreenState('stopped')
    clearScreenFrame()
  }, [clearScreenFrame, updateScreenState])

  useEffect(() => {
    if (!isTauri()) return

    let disposed = false
    let unlisten: (() => void) | undefined
    void onCompanionStatus((payload) => {
      if (disposed) return
      if (payload.pairingGeneration !== undefined) {
        if (payload.pairingGeneration < backendPairingGenerationRef.current) {
          return
        }
        backendPairingGenerationRef.current = payload.pairingGeneration
      }
      setStatus(payload)
      if (payload.stage === 'connected' && payload.device) {
        // A LAN control socket can reconnect while the independent screen socket
        // is still streaming. Do not tear the screen state down on every hello.
        pairingGenerationRef.current += 1
        sessionGenerationRef.current += 1
        setDevices([payload.device])
        setIsPairing(false)
        setLanOffer(null)
      } else if (payload.stage === 'reconnecting') {
        // Keep the last device/offer visible while Android retries the socket.
        setIsPairing(false)
      } else if (payload.stage === 'disconnected') {
        resetScreenState()
        resetRemoteState()
        pairingGenerationRef.current += 1
        setDevices([])
        setIsPairing(false)
        // Keep a still-valid LAN offer visible so a retry does not require a
        // second QR scan. Explicit disconnect() clears it below.
      } else if (payload.stage === 'error') {
        pairingGenerationRef.current += 1
        setIsPairing(false)
        setLanOffer(null)
      }
    })
      .then((stopListening) => {
        if (disposed) stopListening()
        else unlisten = stopListening
      })
      .catch((listenError) => {
        if (!disposed) {
          console.warn('Could not listen for companion status', listenError)
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [resetRemoteState, resetScreenState])

  useEffect(() => {
    if (!isTauri()) return

    let disposed = false
    let unlisten: (() => void) | undefined
    void onCompanionRemoteStatus((payload) => {
      if (!disposed) applyRemoteStatus(payload)
    })
      .then((stopListening) => {
        if (disposed) stopListening()
        else unlisten = stopListening
      })
      .catch((listenError) => {
        if (!disposed) {
          console.warn(
            'Could not listen for companion remote status',
            listenError,
          )
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [applyRemoteStatus])

  useEffect(() => {
    if (!isTauri() || typeof onCompanionScreenStatus !== 'function') return

    let disposed = false
    let unlisten: (() => void) | undefined
    void onCompanionScreenStatus((payload) => {
      if (disposed || payload.generation < screenGenerationRef.current) return
      screenGenerationRef.current = payload.generation
      setScreenStatus(payload)
      updateScreenState(payload.stage)
      if (payload.stage === 'stopped' || payload.stage === 'error') {
        screenOperationRef.current += 1
        clearScreenFrame()
      }
      // Reconnecting intentionally keeps the last good JPEG visible while the
      // Android foreground service establishes the same authenticated socket.
    })
      .then((stopListening) => {
        if (disposed) stopListening()
        else unlisten = stopListening
      })
      .catch((listenError) => {
        if (!disposed) {
          console.warn(
            'Could not listen for companion screen status',
            listenError,
          )
        }
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [clearScreenFrame, updateScreenState])

  const scan = useCallback(async (): Promise<CompanionDevice[]> => {
    const generation = ++scanGenerationRef.current
    resetScreenState()
    resetRemoteState()
    setDevices([])
    setIsPairing(false)
    setLanOffer(null)
    setError(null)
    setStatus(null)

    if (!isTauri()) {
      return []
    }

    setIsScanning(true)
    try {
      const response = await scanCompanionDevices()
      if (generation !== scanGenerationRef.current) return []

      if (!response.success) {
        setDevices([])
        if (response.errorCode !== 'cancelled') {
          setError(response.error || 'Companion scan failed')
        }
        return []
      }

      sessionGenerationRef.current += 1
      setDevices(response.devices)
      return response.devices
    } catch (scanError) {
      if (generation === scanGenerationRef.current) {
        setDevices([])
        setError(errorMessage(scanError))
      }
      return []
    } finally {
      if (generation === scanGenerationRef.current) {
        setIsScanning(false)
      }
    }
  }, [resetRemoteState, resetScreenState])

  const startLanPairing =
    useCallback(async (): Promise<CompanionLanOffer | null> => {
      const generation = ++pairingGenerationRef.current
      scanGenerationRef.current += 1
      resetScreenState()
      resetRemoteState()
      setDevices([])
      setIsScanning(false)
      setIsPairing(true)
      setLanOffer(null)
      setError(null)
      setStatus(null)

      if (!isTauri()) {
        setIsPairing(false)
        setError('LAN companion pairing requires the desktop app')
        return null
      }

      try {
        const offer = await startCompanionLanPairing()
        if (generation !== pairingGenerationRef.current) return null
        backendPairingGenerationRef.current = Math.max(
          backendPairingGenerationRef.current,
          offer.generation,
        )
        setLanOffer(offer)
        return offer
      } catch (pairingError) {
        if (generation === pairingGenerationRef.current) {
          setIsPairing(false)
          setLanOffer(null)
          setError(errorMessage(pairingError))
        }
        return null
      }
    }, [resetRemoteState, resetScreenState])

  const request = useCallback(
    async <T = unknown>(
      method: CompanionMethod,
      params: CompanionParams = {},
    ): Promise<T> => {
      if (!isTauri()) {
        const message = 'Companion requests require the desktop app'
        setError(message)
        throw new CompanionOperationError(message, 'desktop_required')
      }

      const sessionGeneration = sessionGenerationRef.current
      let response
      try {
        response = await requestCompanion<T>(method, params)
      } catch (requestError) {
        const message = errorMessage(requestError)
        if (sessionGeneration === sessionGenerationRef.current) {
          setError(message)
        }
        throw requestError
      }

      const isCurrentSession =
        sessionGeneration === sessionGenerationRef.current
      if (response.disconnected && isCurrentSession) {
        sessionGenerationRef.current += 1
        resetScreenState()
        setDevices([])
      }

      if (!response.success) {
        const operationError = new CompanionOperationError(
          response.error || 'Companion request failed',
          response.errorCode,
          response.disconnected,
        )
        if (response.errorCode !== 'cancelled' && isCurrentSession) {
          setError(operationError.message)
        }
        throw operationError
      }

      if (isCurrentSession) setError(null)
      return response.result as T
    },
    [resetScreenState],
  )

  const startScreen = useCallback(async (): Promise<void> => {
    if (!isTauri()) {
      const message = 'Screen streaming requires the desktop app'
      setError(message)
      throw new CompanionOperationError(message, 'desktop_required')
    }
    if (devices[0]?.transport !== 'lan-tcp') {
      const message = 'Screen streaming currently requires a QR / LAN companion'
      setError(message)
      throw new CompanionOperationError(message, 'lan_required')
    }
    if (isScreenStarting || isScreenStreaming) return

    const operation = ++screenOperationRef.current
    const localGeneration = screenGenerationRef.current
    setScreenStatus({
      generation: localGeneration,
      stage: 'connecting',
      message: 'Connecting to the Android screen stream',
    })
    updateScreenState('connecting')
    clearScreenFrame()
    setError(null)

    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (message) => {
      if (operation !== screenOperationRef.current) return
      const bytes = new Uint8Array(message).slice()
      latestScreenFrameRef.current = bytes
      const nextUrl = URL.createObjectURL(
        new Blob([bytes.buffer], { type: 'image/jpeg' }),
      )
      const previousUrl = screenFrameUrlRef.current
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      screenFrameUrlRef.current = nextUrl
      setScreenFrame(nextUrl)
      updateScreenState('streaming')
      setScreenStatus((previous) =>
        previous
          ? {
              ...previous,
              stage: 'streaming',
              message: 'Receiving Android screen frames',
            }
          : {
              generation: screenGenerationRef.current,
              stage: 'streaming',
              message: 'Receiving Android screen frames',
            },
      )
    }

    try {
      const response = await startCompanionScreen(channel)
      if (operation !== screenOperationRef.current) return
      if (!response.success) {
        const operationError = new CompanionOperationError(
          response.error || 'Could not start the Android screen stream',
          response.errorCode,
          response.disconnected,
        )
        if (response.disconnected) {
          sessionGenerationRef.current += 1
          resetScreenState()
          setDevices([])
        }
        throw operationError
      }
      const result = response.result as
        | { generation?: unknown }
        | null
        | undefined
      if (typeof result?.generation === 'number') {
        screenGenerationRef.current = result.generation
        setScreenStatus((previous) =>
          previous
            ? { ...previous, generation: result.generation as number }
            : previous,
        )
      }
    } catch (screenError) {
      if (operation === screenOperationRef.current) {
        updateScreenState('error')
        setScreenStatus((previous) => ({
          generation: previous?.generation ?? screenGenerationRef.current,
          stage: 'error',
          message: errorMessage(screenError),
          width: previous?.width,
          height: previous?.height,
        }))
        clearScreenFrame()
        setError(errorMessage(screenError))
      }
      throw screenError
    }
  }, [
    clearScreenFrame,
    devices,
    isScreenStarting,
    isScreenStreaming,
    resetScreenState,
    updateScreenState,
  ])

  const stopScreen = useCallback(async (): Promise<void> => {
    if (!isTauri()) return
    const operation = ++screenOperationRef.current
    updateScreenState('stopped')
    setScreenStatus({
      generation: screenGenerationRef.current,
      stage: 'stopped',
      message: 'Stopping the Android screen stream',
    })
    clearScreenFrame()
    try {
      const response = await stopCompanionScreen()
      if (operation !== screenOperationRef.current) return
      if (!response.success) {
        const operationError = new CompanionOperationError(
          response.error || 'Could not stop the Android screen stream',
          response.errorCode,
          response.disconnected,
        )
        if (response.disconnected) {
          sessionGenerationRef.current += 1
          resetScreenState()
          setDevices([])
        } else {
          updateScreenState('error')
          setScreenStatus((previous) => ({
            generation: previous?.generation ?? screenGenerationRef.current,
            stage: 'error',
            message: operationError.message,
          }))
        }
        throw operationError
      }
      const result = response.result as
        | { generation?: unknown }
        | null
        | undefined
      if (typeof result?.generation === 'number') {
        screenGenerationRef.current = result.generation
      }
    } catch (screenError) {
      if (operation === screenOperationRef.current) {
        setError(errorMessage(screenError))
      }
      throw screenError
    }
  }, [clearScreenFrame, resetScreenState, updateScreenState])

  const disconnect = useCallback(async (): Promise<void> => {
    scanGenerationRef.current += 1
    pairingGenerationRef.current += 1
    sessionGenerationRef.current += 1
    resetScreenState()
    resetRemoteState()
    setIsScanning(false)
    setIsPairing(false)
    setLanOffer(null)
    setDevices([])
    setError(null)
    setStatus(null)

    if (!isTauri()) return

    try {
      await disconnectCompanion()
    } catch (disconnectError) {
      setError(errorMessage(disconnectError))
      throw disconnectError
    }
  }, [resetRemoteState, resetScreenState])

  const startRemote = useCallback(
    async (
      serial: string,
      customPath?: string,
      permissions?: CompanionRemotePermission[],
    ): Promise<CompanionRemoteStartResult> => {
      if (!isTauri()) {
        const message = 'Remote control requires the desktop app'
        setError(message)
        throw new CompanionOperationError(message, 'desktop_required')
      }
      if (!serial.trim()) {
        const message =
          'Select an Android target before approving remote control'
        setError(message)
        throw new CompanionOperationError(message, 'target_required')
      }

      const operation = ++remoteOperationRef.current
      remoteEventsBlockedRef.current = false
      setError(null)
      setIsRemoteStarting(true)
      setIsRemoteActive(false)
      setRemoteStatus({
        generation: remoteGenerationRef.current,
        stage: 'starting',
        message: `Starting remote control for ${serial}`,
        targetSerial: serial,
        permissions,
      })

      try {
        const response = await startCompanionRemote(
          serial,
          customPath,
          permissions,
        )
        if (!response.success) {
          throw new CompanionOperationError(
            response.error || 'Could not start remote control',
            response.errorCode,
            response.disconnected,
          )
        }
        const result = response.result ?? {}
        if (operation !== remoteOperationRef.current) return result
        const generation =
          typeof result.generation === 'number'
            ? result.generation
            : remoteGenerationRef.current
        applyRemoteStatus({
          generation,
          stage: result.accepted === false ? 'error' : 'connecting',
          message:
            result.accepted === false
              ? 'Remote control was not accepted'
              : `Waiting for the mobile controller to connect to ${result.targetSerial || result.target || serial}`,
          targetSerial: result.targetSerial || result.target || serial,
          sessionId: result.sessionId,
          permissions: result.permissions ?? permissions,
          videoReady: result.videoReady,
          embeddedAutoStarted: result.embeddedAutoStarted,
        })
        return result
      } catch (remoteError) {
        if (operation === remoteOperationRef.current) {
          const message = errorMessage(remoteError)
          setError(message)
          applyRemoteStatus({
            generation: remoteGenerationRef.current,
            stage: 'error',
            message,
            targetSerial: serial,
          })
        }
        throw remoteError
      }
    },
    [applyRemoteStatus],
  )

  const stopRemote = useCallback(async (): Promise<void> => {
    if (!isTauri()) return
    const operation = ++remoteOperationRef.current
    remoteEventsBlockedRef.current = true
    const previous = remoteStatus
    setIsRemoteStarting(false)
    setRemoteStatus({
      generation: remoteGenerationRef.current,
      stage: 'stopping',
      message: 'Revoking remote control',
      targetSerial: previous?.targetSerial,
      sessionId: previous?.sessionId,
      permissions: previous?.permissions,
      videoReady: previous?.videoReady,
      embeddedAutoStarted: previous?.embeddedAutoStarted,
    })
    try {
      const response = await stopCompanionRemote()
      if (operation !== remoteOperationRef.current) return
      if (!response.success) {
        throw new CompanionOperationError(
          response.error || 'Could not revoke remote control',
          response.errorCode,
          response.disconnected,
        )
      }
      const stoppedGeneration = remoteGenerationRef.current + 1
      remoteGenerationRef.current = stoppedGeneration
      setIsRemoteActive(false)
      setRemoteStatus({
        generation: stoppedGeneration,
        stage: 'stopped',
        message: 'Remote control revoked',
        targetSerial: previous?.targetSerial,
        permissions: previous?.permissions,
        embeddedAutoStarted: previous?.embeddedAutoStarted,
      })
    } catch (remoteError) {
      if (operation === remoteOperationRef.current) {
        remoteEventsBlockedRef.current = false
        const message = errorMessage(remoteError)
        setError(message)
        applyRemoteStatus({
          generation: remoteGenerationRef.current,
          stage: 'error',
          message,
          targetSerial: previous?.targetSerial,
          permissions: previous?.permissions,
          embeddedAutoStarted: previous?.embeddedAutoStarted,
        })
      }
      throw remoteError
    }
  }, [applyRemoteStatus, remoteStatus])

  const getScreenFrameData = useCallback(() => {
    const bytes = latestScreenFrameRef.current
    if (!bytes || bytes.length === 0) return null
    return `data:image/jpeg;base64,${bytesToBase64(bytes)}`
  }, [])

  useEffect(() => {
    return () => {
      const previousUrl = screenFrameUrlRef.current
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      latestScreenFrameRef.current = null
    }
  }, [])

  return {
    devices,
    isScanning,
    isPairing,
    lanOffer,
    error,
    status,
    screenStatus,
    screenFrame,
    getScreenFrameData,
    screenState,
    isScreenStarting,
    isScreenStreaming,
    remoteStatus,
    isRemoteStarting,
    isRemoteActive,
    scan,
    startLanPairing,
    request,
    startScreen,
    stopScreen,
    startRemote,
    stopRemote,
    disconnect,
  }
}
