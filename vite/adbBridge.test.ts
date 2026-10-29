// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  AdbError,
  type Runner,
  handleBridgeRequest,
  isAllowedRequest,
  isReadOnlyShellCommand,
  parseAdbDevicesOutput,
  parsePackageInfo,
} from './adbBridge'

const OK_HEADERS = { host: 'localhost:1420', 'x-adb-bridge': '1' }
const req = (cmd: string, args: unknown = {}, headers: Record<string, string> = OK_HEADERS) => ({
  method: 'POST',
  headers,
  remoteAddress: '127.0.0.1',
  body: JSON.stringify({ cmd, args }),
})

const DEVICES = `List of devices attached
R58M12345\tdevice usb:1-1 product:x model:Pixel
192.168.1.5:5555\tdevice
ZZZ\tunauthorized
adb-abc._adb-tls-connect._tcp\tdevice
R58M12345\tdevice
`

describe('parseAdbDevicesOutput', () => {
  it('ports the Rust rules (dedupe, skip mdns, wifi detection, detail)', () => {
    expect(parseAdbDevicesOutput(DEVICES)).toEqual([
      { serial: 'R58M12345', adbState: 'device', connectionType: 'usb', detail: 'usb:1-1 product:x model:Pixel' },
      { serial: '192.168.1.5:5555', adbState: 'device', connectionType: 'wifi' },
      { serial: 'ZZZ', adbState: 'unauthorized', connectionType: 'usb' },
    ])
  })
})

describe('bridge handler', () => {
  it('get_devices returns the Rust shape', async () => {
    const run: Runner = vi.fn(async () => DEVICES)
    const res = await handleBridgeRequest(req('get_devices'), run)
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.error).toBe(false)
    expect(body.devices).toEqual(['R58M12345', '192.168.1.5:5555'])
    expect(body.deviceRecords).toHaveLength(3)
    expect(body.diagnostics).toHaveLength(1)
    expect(body.diagnostics[0]).toContain('ZZZ with status unauthorized')
    expect(run).toHaveBeenCalledWith(['devices'], expect.objectContaining({ bin: 'adb' }))
  })

  it('get_devices reports runner failure as {error:true,message}', async () => {
    const run: Runner = async () => {
      throw new AdbError('adb_not_found', 'ADB executable not found')
    }
    const res = await handleBridgeRequest(req('get_devices'), run)
    expect(res.body).toEqual({ error: true, message: 'ADB executable not found' })
  })

  it('get_device_status builds the camelCase status', async () => {
    const outputs: Record<string, string> = {
      'getprop ro.product.model': 'Pixel 7\n',
      'getprop ro.product.manufacturer': 'Google\n',
      'getprop ro.build.version.release': '14\n',
      'getprop ro.serialno': 'REAL123\n',
      'cat /proc/uptime': '123.45 99.0\n',
      'settings get system accelerometer_rotation': '1\n',
      'wm size': 'Physical size: 1080x2400\n',
      'dumpsys battery': 'Battery:\n  level: 80\n  temperature: 305\n  status: 2\n',
      'dumpsys power': 'mWakefulness=Awake\n',
      'ip -f inet addr show wlan0': '    inet 192.168.1.9/24 brd\n',
      'df /data': 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/x 1000 400 600 40% /data\n',
      'cat /proc/meminfo': 'MemTotal: 2000 kB\nMemAvailable: 500 kB\n',
    }
    const run: Runner = async (args) => {
      const key = args.slice(3).join(' ')
      if (key in outputs) return outputs[key]
      throw new AdbError('failed', 'nope')
    }
    const res = await handleBridgeRequest(req('get_device_status', { serial: 'R58M12345' }), run)
    expect(res.status).toBe(200)
    expect(JSON.parse(JSON.stringify(res.body))).toEqual({
      success: true,
      serial: 'R58M12345',
      model: 'Pixel 7',
      manufacturer: 'Google',
      androidVersion: '14',
      hardwareSerial: 'REAL123',
      uptimeSeconds: 123,
      autoRotate: true,
      resolution: '1080x2400',
      batteryLevel: 80,
      batteryTemperatureC: 30.5,
      charging: true,
      screenState: 'on',
      ipAddress: '192.168.1.9',
      storageTotalKb: 1000,
      storageUsedKb: 400,
      storageAvailableKb: 600,
      memTotalKb: 2000,
      memAvailableKb: 500,
    })
  })

  it('get_device_status rejects invalid serials without running adb', async () => {
    const run = vi.fn()
    const res = await handleBridgeRequest(req('get_device_status', { serial: 'a; rm -rf /' }), run)
    expect(res.body).toMatchObject({ success: false, errorCode: 'invalid_serial' })
    expect(run).not.toHaveBeenCalled()
  })

  it('list_packages cross-references system / disabled / running', async () => {
    const run: Runner = async (args) => {
      const k = args.slice(3).join(' ')
      if (k === 'pm list packages') return 'package:com.b\npackage:com.a\n'
      if (k === 'pm list packages -s') return 'package:com.a\n'
      if (k === 'pm list packages -d') return 'package:com.b\n'
      if (k === 'ps -A') return 'USER PID NAME\nu0 1 1 1 1 1 S com.a:service\n'
      throw new AdbError('failed', 'x')
    }
    const res = await handleBridgeRequest(req('list_packages', { serial: 'S1', filter: null }), run)
    expect(res.body).toEqual({
      success: true,
      packages: [
        { packageName: 'com.a', system: true, running: true, enabled: true },
        { packageName: 'com.b', system: false, running: false, enabled: false },
      ],
      systemStateAvailable: true,
      enabledStateAvailable: true,
      runningStateAvailable: true,
    })
  })

  it('get_package_info parses dumpsys and sizes', async () => {
    const run: Runner = async (args) => {
      const k = args.slice(3).join(' ')
      if (k.startsWith('dumpsys package'))
        return '  versionCode=42 minSdk=24 targetSdk=34\n  versionName=1.2.3\n  baseCodePath=/data/app/x\n  dataDir=/data/user/0/com.a\n  installerPackageName=null\n'
      if (k === 'du -sk /data/app/x') return '10 /data/app/x\n'
      throw new AdbError('failed', 'x')
    }
    const res = await handleBridgeRequest(req('get_package_info', { serial: 'S1', package: 'com.a' }), run)
    expect(JSON.parse(JSON.stringify(res.body))).toEqual({
      success: true,
      packageName: 'com.a',
      versionCode: '42',
      minSdk: '24',
      targetSdk: '34',
      versionName: '1.2.3',
      baseCodePath: '/data/app/x',
      dataDir: '/data/user/0/com.a',
      apkSizeBytes: 10240,
    })
    expect(parsePackageInfo('versionName=9').versionName).toBe('9')
  })

  it('adb_shell returns {success, output} and blocks mutating commands', async () => {
    const run = vi.fn(async () => 'Pixel\n')
    const ok = await handleBridgeRequest(
      req('adb_shell', { device: 'S1', command: 'getprop ro.product.model' }),
      run,
    )
    expect(ok.body).toEqual({ success: true, output: 'Pixel\n' })
    for (const command of ['rm -rf /sdcard', 'getprop x; reboot', 'cat /proc/../data/x', 'am force-stop com.a', 'input tap 1 1']) {
      const bad = await handleBridgeRequest(req('adb_shell', { device: 'S1', command }), run)
      expect(bad.body).toMatchObject({ success: false })
    }
    expect(run).toHaveBeenCalledTimes(1)
    expect(isReadOnlyShellCommand('wm size')).toBe(true)
    expect(isReadOnlyShellCommand('wm size 1x1')).toBe(true) // only the first two tokens are checked
  })

  it('check_scrcpy parses the version', async () => {
    const run: Runner = async () => 'scrcpy 3.1 <https://github.com/Genymobile/scrcpy>\n'
    const res = await handleBridgeRequest(req('check_scrcpy'), run)
    expect(res.body).toEqual({
      found: true,
      message: 'Scrcpy Ready',
      version: '3.1',
      testedVersion: '5.0.1',
      untested: false,
    })
  })

  it('rejects unknown (and mutating) commands with a 404 error', async () => {
    const run = vi.fn()
    for (const cmd of ['install_apk', 'app_action', 'nope']) {
      const res = await handleBridgeRequest(req(cmd), run)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: `Command "${cmd}" is not available in the browser preview` })
    }
    expect(run).not.toHaveBeenCalled()
  })
})

describe('bridge access control', () => {
  const run = vi.fn()

  it('403s non-local Host headers (DNS rebinding)', async () => {
    for (const host of ['evil.com', 'localhost.evil.com', '192.168.1.5:1420', '']) {
      const res = await handleBridgeRequest(req('get_devices', {}, { host, 'x-adb-bridge': '1' }), run)
      expect(res.status).toBe(403)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('403s a missing or wrong custom header', async () => {
    expect((await handleBridgeRequest(req('get_devices', {}, { host: 'localhost:1420' }), run)).status).toBe(403)
    expect(
      (await handleBridgeRequest(req('get_devices', {}, { host: 'localhost', 'x-adb-bridge': '0' }), run)).status,
    ).toBe(403)
  })

  it('403s foreign Origins and non-loopback peers', () => {
    expect(isAllowedRequest({ ...OK_HEADERS, origin: 'https://evil.com' }, '127.0.0.1')).toBe(false)
    expect(isAllowedRequest({ ...OK_HEADERS, origin: 'http://localhost:1420' }, '127.0.0.1')).toBe(true)
    expect(isAllowedRequest(OK_HEADERS, '192.168.1.20')).toBe(false)
  })

  it('accepts 127.0.0.1 and [::1] hosts', () => {
    expect(isAllowedRequest({ host: '127.0.0.1:1431', 'x-adb-bridge': '1' })).toBe(true)
    expect(isAllowedRequest({ host: '[::1]:1431', 'x-adb-bridge': '1' })).toBe(true)
  })

  it('rejects non-POST and malformed bodies', async () => {
    expect((await handleBridgeRequest({ ...req('get_devices'), method: 'GET' }, run)).status).toBe(405)
    expect((await handleBridgeRequest({ ...req('get_devices'), body: '{' }, run)).status).toBe(400)
    expect((await handleBridgeRequest({ ...req('get_devices'), body: '{}' }, run)).status).toBe(400)
  })
})
