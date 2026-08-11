import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  connectRemoteSimDeck,
  simulatorAction,
  simulatorWebrtcOffer,
  useLocalSimDeck,
} from './simDeckService'

describe('SimDeck service command contracts', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('passes remote pairing details to the backend', async () => {
    invoke.mockResolvedValue({ success: true, url: 'https://simdeck.test' })

    await connectRemoteSimDeck('https://simdeck.test', '123456')

    expect(invoke).toHaveBeenCalledWith('connect_remote_simdeck', {
      url: 'https://simdeck.test',
      pairingCode: '123456',
    })
  })

  it('switches back to the local service without extra arguments', async () => {
    invoke.mockResolvedValue({ success: true })

    await useLocalSimDeck()

    expect(invoke).toHaveBeenCalledWith('use_local_simdeck')
  })

  it('forwards the complete WebRTC offer payload', async () => {
    invoke.mockResolvedValue({ type: 'answer', sdp: 'answer-sdp' })

    await simulatorWebrtcOffer(
      'android:Pixel_8_API_35',
      'offer-sdp',
      'client-1',
      '/opt/simdeck',
    )

    expect(invoke).toHaveBeenCalledWith('simulator_webrtc_offer', {
      udid: 'android:Pixel_8_API_35',
      sdp: 'offer-sdp',
      clientId: 'client-1',
      customPath: '/opt/simdeck',
    })
  })

  it('preserves action parameters and a custom CLI path', async () => {
    invoke.mockResolvedValue({ success: true })

    await simulatorAction(
      'simulator-id',
      'tap',
      { x: 120, y: 240 },
      '/opt/simdeck',
    )

    expect(invoke).toHaveBeenCalledWith('simulator_action', {
      udid: 'simulator-id',
      action: 'tap',
      params: { x: 120, y: 240 },
      customPath: '/opt/simdeck',
    })
  })
})
