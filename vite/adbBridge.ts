/**
 * DEV-ONLY adb bridge.
 *
 * When the frontend is opened in a plain browser (vite dev server) there is no
 * Tauri backend, so `invoke()` cannot reach the Rust adb commands. This module
 * re-implements a small, READ-ONLY subset of those commands in Node and exposes
 * them at `POST /__adb-bridge/invoke` through a vite dev plugin
 * (`apply: 'serve'`, so it is never part of a build).
 *
 * Return shapes mirror src-tauri/src/{commands,device_status,app_manager}.rs and
 * the parsing rules are ported from there.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const BRIDGE_PATH = '/__adb-bridge/invoke'
export const BRIDGE_HEADER = 'x-adb-bridge'
const MAX_BODY_BYTES = 64 * 1024
const MAX_STDOUT = 16 * 1024 * 1024

// ---------------------------------------------------------------------------
// Runner abstraction (injected in tests)
// ---------------------------------------------------------------------------

export class AdbError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RunOptions {
  bin: 'adb' | 'scrcpy'
  customPath?: string | null
  timeoutMs: number
}

/** Runs a binary with an args array (never a shell). Resolves stdout; rejects with AdbError. */
export type Runner = (args: string[], opts: RunOptions) => Promise<string>

/** Port of adb.rs `classify_adb_error`. */
export function classifyAdbError(stderr: string): AdbError {
  const lower = stderr.toLowerCase()
  if (
    lower.includes('inject_events') ||
    lower.includes('injecting input events') ||
    (lower.includes('securityexception') && lower.includes('input'))
  ) {
    return new AdbError(
      'inject_denied',
      'Cannot inject input: wake and unlock the device screen, then try again',
    )
  }
  if (lower.includes('unauthorized'))
    return new AdbError(
      'device_unauthorized',
      'Device is unauthorized (accept the USB debugging prompt)',
    )
  if (lower.includes('offline')) return new AdbError('device_offline', 'Device is offline')
  if (
    lower.includes('device not found') ||
    lower.includes('not found') ||
    lower.includes('no devices') ||
    lower.includes('no such device')
  )
    return new AdbError('device_disconnected', 'Device disconnected or not found')
  if (lower.includes('permission denied') || lower.includes('operation not permitted'))
    return new AdbError('permission_denied', 'Permission denied')
  return new AdbError('failed', stderr.trim())
}

/** Port of commands.rs `get_binary_path` (custom folder, Android SDK roots, then PATH). */
export function resolveBinary(
  name: 'adb' | 'scrcpy',
  customPath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const file = process.platform === 'win32' ? `${name}.exe` : name
  const isFile = (p: string) => {
    try {
      return existsSync(p) && statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (customPath && customPath.trim()) {
    const candidate = join(customPath, file)
    if (isFile(candidate)) return candidate
  }
  if (name === 'adb') {
    const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(Boolean) as string[]
    if (process.platform === 'darwin') roots.push(join(homedir(), 'Library/Android/sdk'))
    else if (process.platform === 'linux') roots.push(join(homedir(), 'Android/Sdk'))
    else if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'Android/Sdk'))
    for (const root of roots) {
      const candidate = join(root, 'platform-tools', file)
      if (isFile(candidate)) return candidate
    }
  }
  return name
}

/** Real runner: execFile (no shell) with timeout, mirroring adb.rs `run_adb_text`. */
export const execRunner: Runner = (args, opts) =>
  new Promise((resolve, reject) => {
    const bin = resolveBinary(opts.bin, opts.customPath)
    execFile(
      bin,
      args,
      { timeout: opts.timeoutMs, maxBuffer: MAX_STDOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          if (e.code === 'ENOENT')
            return reject(new AdbError('adb_not_found', 'ADB executable not found'))
          if (e.killed) return reject(new AdbError('timeout', 'ADB command timed out'))
          return reject(classifyAdbError(String(stderr || e.message)))
        }
        if (!stdout && String(stderr).trim()) {
          const c = classifyAdbError(String(stderr))
          if (c.code !== 'failed') return reject(c)
        }
        resolve(String(stdout))
      },
    )
  })

// ---------------------------------------------------------------------------
// Validation (ports of adb.rs validate_serial / validate_package_name)
// ---------------------------------------------------------------------------

const INVALID_SERIAL = new AdbError('invalid_serial', 'Invalid device serial')
const INVALID_PACKAGE = new AdbError('invalid_package', 'Invalid package name')

export function validateSerial(serial: string): void {
  if (!serial || serial.length > 128 || !/^[A-Za-z0-9.:_-]+$/.test(serial)) throw INVALID_SERIAL
}

export function validatePackageName(pkg: string): void {
  if (!pkg || pkg.length > 255) throw INVALID_PACKAGE
  const segs = pkg.split('.')
  if (segs.length < 2 || !segs.every((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)))
    throw INVALID_PACKAGE
}

// ---------------------------------------------------------------------------
// get_devices (commands.rs)
// ---------------------------------------------------------------------------

export interface DiscoveredAdbDevice {
  serial: string
  adbState: string
  connectionType: 'usb' | 'wifi'
  detail?: string
}

export function parseAdbDevicesOutput(output: string): DiscoveredAdbDevice[] {
  const records: DiscoveredAdbDevice[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/).filter(Boolean)
    if (parts.length < 2) continue
    const serial = parts[0]
    if (serial.includes('._tcp') || serial.includes('._udp') || seen.has(serial)) continue
    seen.add(serial)
    records.push({
      serial,
      adbState: parts[1],
      connectionType: serial.includes(':') ? 'wifi' : 'usb',
      ...(parts.length > 2 ? { detail: parts.slice(2).join(' ') } : {}),
    })
  }
  return records
}

async function getDevices(run: Runner, customPath?: string | null) {
  try {
    const out = await run(['devices'], { bin: 'adb', customPath, timeoutMs: 15000 })
    const deviceRecords = parseAdbDevicesOutput(out)
    const devices = deviceRecords.filter((r) => r.adbState === 'device').map((r) => r.serial)
    const diagnostics = deviceRecords
      .filter((r) => r.adbState !== 'device')
      .map(
        (r) =>
          `ADB detected ${r.serial} with status ${r.adbState}${r.detail ? ` (${r.detail})` : ''}. Unlock the phone, enable USB debugging, and accept the RSA prompt; for offline, reconnect the cable or restart ADB.`,
      )
    return { error: false, devices, deviceRecords, diagnostics }
  } catch (e) {
    return { error: true, message: (e as Error).message }
  }
}

// ---------------------------------------------------------------------------
// check_scrcpy (commands.rs)
// ---------------------------------------------------------------------------

const MAX_TESTED_SCRCPY_VERSION = '5.0.1'

export function parseScrcpyVersion(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(/\s+/).filter(Boolean)
    const idx = parts.indexOf('scrcpy')
    if (idx >= 0 && parts[idx + 1] !== undefined) {
      const cleaned = parts[idx + 1].replace(/^v+/, '')
      if (/^\d/.test(cleaned)) return cleaned
    }
  }
  return null
}

/** True when `remote` is newer than `local` (commands.rs `compare_versions`). */
export function compareVersions(local: string, remote: string): boolean {
  const nums = (v: string) =>
    v
      .split('.')
      .map((s) => /^\d+/.exec(s)?.[0])
      .filter((s): s is string => s !== undefined)
      .map(Number)
  const l = nums(local)
  const r = nums(remote)
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    const a = l[i] ?? 0
    const b = r[i] ?? 0
    if (b > a) return true
    if (a > b) return false
  }
  return false
}

async function checkScrcpy(run: Runner, customPath?: string | null) {
  try {
    const out = await run(['--version'], { bin: 'scrcpy', customPath, timeoutMs: 10000 })
    const version = parseScrcpyVersion(out)
    return {
      found: true,
      message: 'Scrcpy Ready',
      version,
      testedVersion: MAX_TESTED_SCRCPY_VERSION,
      untested: version ? compareVersions(MAX_TESTED_SCRCPY_VERSION, version) : false,
    }
  } catch (e) {
    const code = (e as AdbError).code
    return {
      found: false,
      message:
        code === 'adb_not_found' ? 'Scrcpy not found' : 'Failed to start scrcpy (Exit Code != 0)',
    }
  }
}

// ---------------------------------------------------------------------------
// get_device_status (device_status.rs)
// ---------------------------------------------------------------------------

const STATUS_TIMEOUT = 15000

export function valueAfterColon(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t.toLowerCase().startsWith(key.toLowerCase())) {
      const i = t.indexOf(':')
      if (i >= 0) {
        const v = t.slice(i + 1).trim()
        if (v) return v
      }
    }
  }
  return undefined
}

const intOf = (v: string | undefined) =>
  v !== undefined && /^[+-]?\d+$/.test(v) ? Number(v) : undefined
const uintOf = (v: string | undefined) =>
  v !== undefined && /^\+?\d+$/.test(v) ? Number(v) : undefined

export function parseBattery(text: string) {
  const level = intOf(valueAfterColon(text, 'level'))
  const t = intOf(valueAfterColon(text, 'temperature'))
  const temperature = t === undefined ? undefined : t / 10
  let charging: boolean | undefined
  const status = intOf(valueAfterColon(text, 'status'))
  if (status !== undefined) charging = status === 2
  for (const src of ['AC powered', 'USB powered', 'Wireless powered']) {
    if (valueAfterColon(text, src)?.toLowerCase() === 'true') charging = true
  }
  return { level, temperature, charging }
}

export function parseScreenState(text: string): 'on' | 'off' | 'dozing' | undefined {
  const lc = text.toLowerCase()
  if (lc.includes('display power: state=doze')) return 'dozing'
  if (lc.includes('display power: state=on')) return 'on'
  if (lc.includes('display power: state=off')) return 'off'
  for (const raw of lc.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.includes('mwakefulness=dozing')) return 'dozing'
    if (
      line.includes('mwakefulness=awake') ||
      line.includes('mwakefulness=dreaming') ||
      line.includes('mscreenon=true') ||
      line.includes('minteractive=true')
    )
      return 'on'
    if (
      line.includes('mwakefulness=asleep') ||
      line.includes('mscreenon=false') ||
      line.includes('minteractive=false')
    )
      return 'off'
  }
  return undefined
}

export function parseIp(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (t.startsWith('inet ')) {
      const addr = t.slice(5).split('/')[0].trim()
      if (addr && addr !== '127.0.0.1') return addr
    }
  }
  return undefined
}

export function parseDf(text: string): [number?, number?, number?] {
  for (const line of text.split(/\r?\n/).slice(1)) {
    const f = line.split(/\s+/).filter(Boolean)
    if (f.length >= 6) {
      const total = uintOf(f[f.length - 5])
      const used = uintOf(f[f.length - 4])
      const avail = uintOf(f[f.length - 3])
      if (total !== undefined || used !== undefined) return [total, used, avail]
    }
  }
  return []
}

export function parseMeminfo(text: string): [number?, number?] {
  let total: number | undefined
  let available: number | undefined
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (t.startsWith('MemTotal:')) total = uintOf(t.slice(9).trim().split(/\s+/)[0])
    else if (t.startsWith('MemAvailable:')) available = uintOf(t.slice(13).trim().split(/\s+/)[0])
    if (total !== undefined && available !== undefined) break
  }
  return [total, available]
}

export function parseUptimeSeconds(text: string): number | undefined {
  const first = text.trim().split(/\s+/)[0]
  const n = Number(first)
  return first && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

const ROTATION_TOKENS: Record<string, number> = {
  ROTATION_0: 0,
  '0': 0,
  ROTATION_90: 1,
  '1': 1,
  ROTATION_180: 2,
  '2': 2,
  ROTATION_270: 3,
  '3': 3,
}

export function parseDisplayRotation(text: string): number | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    for (const marker of ['SurfaceOrientation:', 'mCurrentOrientation=']) {
      const i = line.indexOf(marker)
      if (i >= 0) {
        const v = uintOf(line.slice(i + marker.length).trim())
        if (v !== undefined && v <= 3) return v
      }
    }
    const m = 'mCurrentRotation='
    const j = line.indexOf(m)
    if (j >= 0) return ROTATION_TOKENS[line.slice(j + m.length).trim().split(/\s+/)[0]]
  }
  return undefined
}

function isUsableHardwareSerial(value: string): boolean {
  const v = value.trim()
  return !!v && v.toLowerCase() !== 'unknown' && !/^0+$/.test(v) && v !== '0123456789ABCDEF'
}

async function getDeviceStatus(run: Runner, serialArg: string, customPath?: string | null) {
  const serial = String(serialArg ?? '').trim()
  try {
    validateSerial(serial)
  } catch (e) {
    return { success: false, serial, error: (e as AdbError).message, errorCode: (e as AdbError).code }
  }
  const sh = async (...args: string[]) => {
    try {
      return await run(['-s', serial, 'shell', ...args], {
        bin: 'adb',
        customPath,
        timeoutMs: STATUS_TIMEOUT,
      })
    } catch {
      return undefined
    }
  }
  const prop = async (p: string) => {
    const v = (await sh('getprop', p))?.trim()
    return v ? v : undefined
  }

  const [
    model,
    manufacturer,
    androidVersion,
    sdk,
    abi,
    securityPatch,
    bootloaderRaw,
    roSerial,
    uptime,
    autoRotateRaw,
    timeoutRaw,
    wmSize,
    dumpInput,
    density,
    battery,
    power,
    ipAddr,
    df,
    meminfo,
  ] = await Promise.all([
    prop('ro.product.model'),
    prop('ro.product.manufacturer'),
    prop('ro.build.version.release'),
    prop('ro.build.version.sdk'),
    prop('ro.product.cpu.abi'),
    prop('ro.build.version.security_patch'),
    prop('ro.bootloader'),
    prop('ro.serialno'),
    sh('cat', '/proc/uptime'),
    sh('settings', 'get', 'system', 'accelerometer_rotation'),
    sh('settings', 'get', 'system', 'screen_off_timeout'),
    sh('wm', 'size'),
    sh('dumpsys', 'input'),
    sh('wm', 'density'),
    sh('dumpsys', 'battery'),
    sh('dumpsys', 'power'),
    sh('ip', '-f', 'inet', 'addr', 'show', 'wlan0'),
    sh('df', '/data'),
    sh('cat', '/proc/meminfo'),
  ])

  const hwRaw = roSerial ?? (await prop('ro.boot.serialno'))
  const hardwareSerial = hwRaw !== undefined && isUsableHardwareSerial(hwRaw) ? hwRaw : undefined
  const bootloader =
    bootloaderRaw && bootloaderRaw.toLowerCase() !== 'unknown' ? bootloaderRaw : undefined

  let ipAddress = ipAddr !== undefined ? parseIp(ipAddr) : undefined
  if (ipAddress === undefined) {
    const route = await sh('ip', 'route')
    for (const line of (route ?? '').split(/\r?\n/)) {
      const pos = line.indexOf(' src ')
      if (pos >= 0) {
        const addr = (line.slice(pos + 5).trim().split(/\s+/)[0] ?? '').trim()
        if (addr) {
          ipAddress = addr
          break
        }
      }
    }
  }

  const b = battery !== undefined ? parseBattery(battery) : undefined
  const [storageTotal, storageUsed, storageAvail] = df !== undefined ? parseDf(df) : []
  const [memTotal, memAvail] = meminfo !== undefined ? parseMeminfo(meminfo) : []

  return {
    success: true,
    serial,
    model,
    manufacturer,
    androidVersion,
    sdk,
    abi,
    securityPatch,
    bootloader,
    hardwareSerial,
    uptimeSeconds: uptime !== undefined ? parseUptimeSeconds(uptime) : undefined,
    resolution: wmSize !== undefined ? valueAfterColon(wmSize, 'Physical size') : undefined,
    rotation: dumpInput !== undefined ? parseDisplayRotation(dumpInput) : undefined,
    density: density !== undefined ? valueAfterColon(density, 'Physical density') : undefined,
    batteryLevel: b?.level,
    batteryTemperatureC: b?.temperature,
    charging: b?.charging,
    screenState: power !== undefined ? parseScreenState(power) : undefined,
    ipAddress,
    storageTotalKb: storageTotal,
    storageUsedKb: storageUsed,
    storageAvailableKb: storageAvail,
    memTotalKb: memTotal,
    memAvailableKb: memAvail,
    autoRotate:
      autoRotateRaw === undefined
        ? undefined
        : ({ '1': true, '0': false } as Record<string, boolean>)[autoRotateRaw.trim()],
    screenTimeoutMs: timeoutRaw !== undefined ? uintOf(timeoutRaw.trim()) : undefined,
  }
}

// ---------------------------------------------------------------------------
// list_packages / get_package_info (app_manager.rs)
// ---------------------------------------------------------------------------

const LIST_TIMEOUT = 20000
const INFO_TIMEOUT = 15000

interface PackageEntry {
  packageName: string
  system: boolean
  running: boolean
  enabled: boolean
}

export function parsePackageLines(text: string, system: boolean): PackageEntry[] {
  const out: PackageEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (line.startsWith('package:')) line = line.slice(8)
    const name = line.trim()
    if (name) out.push({ packageName: name, system, running: false, enabled: true })
  }
  return out.sort((a, b) =>
    a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0,
  )
}

export function parseRunningPackages(text: string): Set<string> {
  const set = new Set<string>()
  for (const line of text.split(/\r?\n/).slice(1)) {
    const last = line.split(/\s+/).filter(Boolean).pop()
    if (last && last.includes('.')) set.add(last.split(':')[0])
  }
  return set
}

async function listPackages(
  run: Runner,
  serialArg: string,
  filterArg?: string | null,
  customPath?: string | null,
) {
  const serial = String(serialArg ?? '').trim()
  const fail = (e: AdbError) => ({
    success: false,
    packages: [] as PackageEntry[],
    systemStateAvailable: false,
    enabledStateAvailable: false,
    runningStateAvailable: false,
    error: e.message,
    errorCode: e.code,
  })
  try {
    validateSerial(serial)
  } catch (e) {
    return fail(e as AdbError)
  }
  const filter = filterArg || 'all'
  const flag = (
    { third_party: '-3', system: '-s', enabled: '-e', disabled: '-d' } as Record<string, string>
  )[filter]
  const sh = (...args: string[]) =>
    run(['-s', serial, 'shell', ...args], { bin: 'adb', customPath, timeoutMs: LIST_TIMEOUT })

  let text: string
  try {
    text = await sh('pm', 'list', 'packages', ...(flag ? [flag] : []))
  } catch (e) {
    return fail(e as AdbError)
  }
  const packages = parsePackageLines(text, filter === 'system')
  let systemStateAvailable = filter === 'third_party' || filter === 'system'
  if (!systemStateAvailable) {
    try {
      const set = new Set(
        parsePackageLines(await sh('pm', 'list', 'packages', '-s'), true).map((p) => p.packageName),
      )
      systemStateAvailable = true
      for (const p of packages) p.system = set.has(p.packageName)
    } catch {
      /* leave unavailable */
    }
  }
  let disabled = new Set<string>()
  let enabledStateAvailable = false
  if (filter === 'disabled') {
    disabled = new Set(packages.map((p) => p.packageName))
    enabledStateAvailable = true
  } else {
    try {
      disabled = new Set(
        parsePackageLines(await sh('pm', 'list', 'packages', '-d'), false).map((p) => p.packageName),
      )
      enabledStateAvailable = true
    } catch {
      /* unavailable */
    }
  }
  let running = new Set<string>()
  let runningStateAvailable = false
  try {
    running = parseRunningPackages(await sh('ps', '-A'))
    runningStateAvailable = true
  } catch {
    /* unavailable */
  }
  for (const p of packages) {
    p.enabled = !disabled.has(p.packageName)
    p.running = running.has(p.packageName)
  }
  return {
    success: true,
    packages,
    systemStateAvailable,
    enabledStateAvailable,
    runningStateAvailable,
  }
}

function valueAfter(line: string, key: string): string | undefined {
  const i = line.indexOf(key)
  if (i < 0) return undefined
  const v = line
    .slice(i + key.length)
    .trim()
    .split(/\s+/)[0]
  return v && v !== 'null' ? v : undefined
}

export function parsePackageInfo(text: string) {
  const info: Record<string, string | boolean | undefined> = {}
  const setOnce = (k: string, v: string | boolean | undefined) => {
    if (info[k] === undefined && v !== undefined) info[k] = v
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const after = (p: string) => (line.startsWith(p) ? line.slice(p.length) : undefined)
    if (info.versionName === undefined) {
      const v = after('versionName=')?.trim().split(/\s+/)[0]
      if (v) info.versionName = v
    }
    setOnce('versionCode', valueAfter(line, 'versionCode='))
    setOnce('firstInstallTime', after('firstInstallTime='))
    setOnce('lastUpdateTime', after('lastUpdateTime='))
    setOnce('codePath', after('codePath='))
    setOnce('baseCodePath', after('baseCodePath='))
    setOnce('dataDir', after('dataDir='))
    setOnce('uid', after('userId='))
    setOnce('targetSdk', valueAfter(line, 'targetSdk='))
    setOnce('minSdk', valueAfter(line, 'minSdk='))
    const inst = after('installerPackageName=')
    if (inst !== undefined && inst !== 'null') setOnce('installSource', inst)
    if (info.debuggable === undefined && line.startsWith('pkgFlags=')) {
      info.debuggable = line
        .split(/\s+/)
        .some((f) => f.replace(/^[[\]]+|[[\]]+$/g, '') === 'DEBUGGABLE')
    }
    if (info.enabled === undefined && line.startsWith('User 0:')) {
      const v = valueAfter(line, 'enabled=')
      if (v === '0' || v === '1') info.enabled = true
      else if (v === '2' || v === '3' || v === '4') info.enabled = false
    }
  }
  return info as {
    versionName?: string
    versionCode?: string
    firstInstallTime?: string
    lastUpdateTime?: string
    codePath?: string
    baseCodePath?: string
    dataDir?: string
    uid?: string
    targetSdk?: string
    minSdk?: string
    debuggable?: boolean
    enabled?: boolean
    installSource?: string
  }
}

export function parseDuBytes(text: string): number | undefined {
  const first = text.trim().split(/\s+/)[0]
  return first && /^\d+$/.test(first) ? Number(first) * 1024 : undefined
}

async function getPackageInfo(
  run: Runner,
  serialArg: string,
  packageArg: string,
  customPath?: string | null,
) {
  const serial = String(serialArg ?? '').trim()
  const packageName = String(packageArg ?? '').trim()
  try {
    validateSerial(serial)
    validatePackageName(packageName)
  } catch (e) {
    return {
      success: false,
      packageName,
      error: (e as AdbError).message,
      errorCode: (e as AdbError).code,
    }
  }
  const sh = (...args: string[]) =>
    run(['-s', serial, 'shell', ...args], { bin: 'adb', customPath, timeoutMs: INFO_TIMEOUT })
  try {
    const info = parsePackageInfo(await sh('dumpsys', 'package', packageName))
    const du = async (path?: string) => {
      if (!path) return undefined
      try {
        return parseDuBytes(await sh('du', '-sk', path))
      } catch {
        return undefined
      }
    }
    const [apkSizeBytes, dataSizeBytes] = await Promise.all([
      du(info.baseCodePath ?? info.codePath),
      du(info.dataDir),
    ])
    return { success: true, packageName, ...info, apkSizeBytes, dataSizeBytes }
  } catch (e) {
    return {
      success: false,
      packageName,
      error: (e as Error).message,
      errorCode: (e as AdbError).code,
    }
  }
}

// ---------------------------------------------------------------------------
// adb_shell (commands.rs) - restricted to a read-only allow-list
// ---------------------------------------------------------------------------

const SHELL_META = /[;&|<>`$\\"'(){}*?!\n\r]/

/** Only plain, read-only inspection commands are allowed through the browser bridge. */
export function isReadOnlyShellCommand(command: string): boolean {
  if (!command || command.length > 256 || SHELL_META.test(command)) return false
  const [cmd, sub, ...rest] = command.trim().split(/\s+/)
  const noDotDot = (v?: string) => !!v && !v.includes('..')
  switch (cmd) {
    case 'getprop':
    case 'dumpsys':
    case 'df':
    case 'uptime':
    case 'date':
    case 'id':
    case 'whoami':
    case 'uname':
    case 'ps':
    case 'du':
      return true
    case 'ip':
      return ['addr', 'route', '-f', 'link'].includes(sub ?? '')
    case 'wm':
      return sub === 'size' || sub === 'density'
    case 'settings':
      return sub === 'get' || sub === 'list'
    case 'pm':
      return sub === 'list' || sub === 'path'
    case 'cat':
      return rest.length === 0 && noDotDot(sub) && /^\/(proc|sys)\//.test(sub ?? '')
    case 'ls':
      return [sub, ...rest].filter((a) => a && !a.startsWith('-')).every((a) => noDotDot(a))
    default:
      return false
  }
}

async function adbShell(run: Runner, device: string, command: string, customPath?: string | null) {
  const serial = String(device ?? '').trim()
  try {
    validateSerial(serial)
  } catch (e) {
    return { success: false, message: (e as AdbError).message }
  }
  if (!isReadOnlyShellCommand(command)) {
    return {
      success: false,
      message: 'Command is not available in the browser preview (read-only commands only)',
    }
  }
  try {
    const output = await run(['-s', serial, 'shell', command], {
      bin: 'adb',
      customPath,
      timeoutMs: 30000,
    })
    return { success: true, output }
  } catch (e) {
    return { success: false, message: (e as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Dispatch + HTTP layer
// ---------------------------------------------------------------------------

export const SUPPORTED_COMMANDS = [
  'get_devices',
  'get_device_status',
  'list_packages',
  'get_package_info',
  'adb_shell',
  'check_scrcpy',
] as const

type Args = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const optStr = (v: unknown) => (typeof v === 'string' ? v : null)

export class BridgeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function dispatch(cmd: string, args: Args, run: Runner): Promise<unknown> {
  const customPath = optStr(args.customPath)
  switch (cmd) {
    case 'get_devices':
      return getDevices(run, customPath)
    case 'check_scrcpy':
      return checkScrcpy(run, customPath)
    case 'get_device_status':
      return getDeviceStatus(run, str(args.serial), customPath)
    case 'list_packages':
      return listPackages(run, str(args.serial), optStr(args.filter), customPath)
    case 'get_package_info':
      return getPackageInfo(run, str(args.serial), str(args.package), customPath)
    case 'adb_shell':
      return adbShell(run, str(args.device), str(args.command), customPath)
    default:
      throw new BridgeError(404, `Command "${cmd}" is not available in the browser preview`)
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase())
  return m?.[1]
}

type Headers = Record<string, string | string[] | undefined>

/** Host must be loopback, the custom header present, Origin (if any) loopback, peer loopback. */
export function isAllowedRequest(headers: Headers, remoteAddress?: string): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const host = hostnameOf(one(headers.host))
  if (!host || !LOCAL_HOSTS.has(host)) return false
  if (one(headers[BRIDGE_HEADER]) !== '1') return false
  const origin = one(headers.origin)
  if (origin !== undefined) {
    try {
      const h = new URL(origin).hostname // IPv6 comes back bracketed
      if (!LOCAL_HOSTS.has(h)) return false
    } catch {
      return false
    }
  }
  if (remoteAddress !== undefined && !/^(127\.|::1$|::ffff:127\.)/.test(remoteAddress)) return false
  return true
}

export interface BridgeResponse {
  status: number
  body: unknown
}

/** Transport-independent request handler (what the tests exercise). */
export async function handleBridgeRequest(
  req: { method?: string; headers: Headers; remoteAddress?: string; body: string },
  run: Runner = execRunner,
): Promise<BridgeResponse> {
  if (!isAllowedRequest(req.headers, req.remoteAddress))
    return { status: 403, body: { error: 'Forbidden' } }
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  let parsed: { cmd?: unknown; args?: unknown }
  try {
    parsed = JSON.parse(req.body)
  } catch {
    return { status: 400, body: { error: 'Invalid JSON body' } }
  }
  if (!parsed || typeof parsed.cmd !== 'string')
    return { status: 400, body: { error: 'Missing "cmd"' } }
  const args =
    parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
      ? (parsed.args as Args)
      : {}
  try {
    return { status: 200, body: await dispatch(parsed.cmd, args, run) }
  } catch (e) {
    if (e instanceof BridgeError) return { status: e.status, body: { error: e.message } }
    return { status: 500, body: { error: (e as Error).message } }
  }
}

export function createBridgeMiddleware(run: Runner = execRunner) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (r: BridgeResponse) => {
      res.statusCode = r.status
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(r.body))
    }
    // Reject before reading any body.
    if (!isAllowedRequest(req.headers, req.socket.remoteAddress))
      return send({ status: 403, body: { error: 'Forbidden' } })
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        send({ status: 413, body: { error: 'Request too large' } })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', async () => {
      if (res.writableEnded) return
      send(
        await handleBridgeRequest(
          {
            method: req.method,
            headers: req.headers,
            remoteAddress: req.socket.remoteAddress,
            body: Buffer.concat(chunks).toString('utf8'),
          },
          run,
        ),
      )
    })
  }
}

/** Vite dev plugin. `apply: 'serve'` keeps it out of production builds. */
export function adbBridgePlugin() {
  return {
    name: 'adb-bridge',
    apply: 'serve' as const,
    configureServer(server: {
      middlewares: {
        use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void
      }
    }) {
      server.middlewares.use(BRIDGE_PATH, createBridgeMiddleware())
    },
  }
}
