import { useEffect, useRef } from 'react'
import type { CompanionStatusEvent, CompanionTelemetryEvent } from '../types/companion'

interface UseAgentBridgeParams {
  status: CompanionStatusEvent | null
  telemetry: CompanionTelemetryEvent | null
  applyAgentStatus: (
    companionDevice: { agentDeviceId?: string; peerIp?: string },
    telemetry: { battery?: number; wifiConnected?: boolean } | null,
  ) => void
  applyAgentDisconnected: (agentDeviceId: string) => void
}

/**
 * Bridges the Companion connection's status/telemetry (`useCompanion`) into
 * the device registry (`useDeviceRegistry`) so a connected Mobile Studio
 * Agent shows up in Device Wall (doc §3/§9). Pure glue between two existing
 * hooks — not a new connection manager.
 */
export function useAgentBridge({
  status,
  telemetry,
  applyAgentStatus,
  applyAgentDisconnected,
}: UseAgentBridgeParams) {
  const lastAgentDeviceIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (status?.stage === 'connected' && status.device?.agentDeviceId) {
      lastAgentDeviceIdRef.current = status.device.agentDeviceId
      applyAgentStatus(
        {
          agentDeviceId: status.device.agentDeviceId,
          peerIp: status.device.peerIp,
        },
        null,
      )
    } else if (status?.stage === 'disconnected' && lastAgentDeviceIdRef.current) {
      applyAgentDisconnected(lastAgentDeviceIdRef.current)
      lastAgentDeviceIdRef.current = undefined
    }
  }, [status, applyAgentStatus, applyAgentDisconnected])

  useEffect(() => {
    if (!telemetry?.agentDeviceId) return
    applyAgentStatus(
      { agentDeviceId: telemetry.agentDeviceId },
      { battery: telemetry.battery, wifiConnected: telemetry.wifiConnected },
    )
  }, [telemetry, applyAgentStatus])
}
