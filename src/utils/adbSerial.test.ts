import { describe, expect, it } from 'vitest'
import { hostFromNetworkSerial, isWirelessSerial } from './adbSerial'

describe('adbSerial', () => {
  it('detects network transports', () => {
    expect(isWirelessSerial('192.168.1.23:5555')).toBe(true)
    expect(isWirelessSerial('adb-R58M._adb-tls-connect._tcp')).toBe(true)
    expect(isWirelessSerial('R58M123ABC')).toBe(false)
  })

  it('extracts the host only from host:port serials', () => {
    expect(hostFromNetworkSerial('192.168.1.23:5555')).toBe('192.168.1.23')
    expect(hostFromNetworkSerial('adb-R58M._adb-tls-connect._tcp')).toBeUndefined()
    expect(hostFromNetworkSerial('R58M123ABC')).toBeUndefined()
  })
})
