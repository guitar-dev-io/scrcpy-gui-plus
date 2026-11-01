/**
 * adb serial shapes:
 * - USB: the device's hardware serial (`R58M123ABC`)
 * - `adb connect` / `adb tcpip`: `host:port` (`192.168.1.23:5555`)
 * - Android 11+ Wireless Debugging auto-connected over mDNS:
 *   `adb-<id>._adb-tls-connect._tcp`
 */
export function isWirelessSerial(serial: string): boolean {
  return serial.includes(':') || serial.includes('._tcp')
}

/** The IP/host part of a `host:port` serial; undefined for USB and mDNS serials. */
export function hostFromNetworkSerial(serial: string): string | undefined {
  if (!serial.includes(':')) return undefined
  const host = serial.slice(0, serial.lastIndexOf(':'))
  return host || undefined
}
