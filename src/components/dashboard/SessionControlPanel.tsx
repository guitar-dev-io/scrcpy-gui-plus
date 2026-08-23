import { useState } from 'react'
import { CirclePower, Settings } from 'lucide-react'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import type { DeviceActionId } from '../../types/deviceControl'
import { formatUptime, type DeviceStatus } from '../../types/deviceStatus'

const panel =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

const screenTimeoutActions: Readonly<Record<number, DeviceActionId>> = {
  15000: 'screen_timeout_15s',
  30000: 'screen_timeout_30s',
  60000: 'screen_timeout_60s',
  120000: 'screen_timeout_120s',
  300000: 'screen_timeout_300s',
  600000: 'screen_timeout_600s',
}

const screenTimeoutOptions = [
  [15000, '15 seconds'],
  [30000, '30 seconds'],
  [60000, '1 minute'],
  [120000, '2 minutes'],
  [300000, '5 minutes'],
  [600000, '10 minutes'],
] as const

function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-left text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-base)] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
    >
      <span>{label}</span>
      <span className={`relative h-4 w-8 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[17px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}

type ControlTab = 'control' | 'inspector' | 'settings'

interface SessionControlPanelProps {
  activeDevice: string
  connection?: string
  status: DeviceStatus | null
  config: ScrcpyConfig
  pending: Readonly<Record<string, boolean>>
  isRunning: boolean
  onUpdateConfig: <K extends keyof ScrcpyConfig>(key: K, value: ScrcpyConfig[K]) => void
  onUpdateDeviceSetting: (action: DeviceActionId) => void
  onOpenSettings: () => void
  onStart: () => void
  onStop: () => void
}

export default function SessionControlPanel({
  activeDevice,
  connection,
  status,
  config,
  pending,
  isRunning,
  onUpdateConfig,
  onUpdateDeviceSetting,
  onOpenSettings,
  onStart,
  onStop,
}: SessionControlPanelProps) {
  const [activeTab, setActiveTab] = useState<ControlTab>('control')
  const tabs: Array<{ id: ControlTab; label: string }> = [
    { id: 'control', label: 'Control' },
    { id: 'inspector', label: 'Inspector' },
    { id: 'settings', label: 'Settings' },
  ]
  const infoRows = [
    ['Model', status?.model],
    ['Serial', activeDevice],
    ['Android', status?.androidVersion],
    ['Resolution', status?.resolution],
    ['Connection', connection],
    ['Battery', status?.batteryLevel !== undefined ? `${status.batteryLevel}%` : undefined],
    ['Manufacturer', status?.manufacturer],
    ['SDK', status?.sdk],
    ['ABI', status?.abi],
    ['Security Patch', status?.securityPatch],
    ['Bootloader', status?.bootloader],
    ['Uptime', formatUptime(status?.uptimeSeconds)],
    ['Density', status?.density],
    ['IP Address', status?.ipAddress],
  ]

  return (
    <section className={`${panel} h-full min-h-0 overflow-hidden pl-1.5`}>
      <div className="flex h-11 items-end gap-4 border-b border-[var(--border-subtle)] px-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'true' : undefined}
            className={`h-full border-b-2 text-[9px] font-semibold uppercase tracking-wide ${focusRing} ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-base)]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="custom-scrollbar h-[calc(100%-2.75rem)] overflow-y-auto p-4">
        {activeTab === 'control' && (
          <div className="space-y-4">
            <section>
              <h2 className="mb-2 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">Session</h2>
              <Switch checked={config.stayAwake || false} onChange={(value) => onUpdateConfig('stayAwake', value)} label="Keep Screen On" />
              <Switch checked={config.keepActive || false} onChange={(value) => onUpdateConfig('keepActive', value)} label="Stay Awake" />
              <Switch
                checked={status?.autoRotate ?? false}
                disabled={!activeDevice || status?.autoRotate === undefined || Boolean(pending.auto_rotate_on || pending.auto_rotate_off)}
                onChange={(value) => onUpdateDeviceSetting(value ? 'auto_rotate_on' : 'auto_rotate_off')}
                label="Auto Rotate"
              />
              <label className="mt-1 block text-[8px] uppercase tracking-wide text-[var(--text-subtle)]">
                Screen Timeout
                <select
                  value={status?.screenTimeoutMs ?? 0}
                  onChange={(event) => {
                    const nextAction = screenTimeoutActions[Number(event.target.value)]
                    if (nextAction) onUpdateDeviceSetting(nextAction)
                  }}
                  disabled={!activeDevice || status?.screenTimeoutMs === undefined}
                  className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] normal-case text-[var(--text-base)] outline-none focus:border-primary disabled:opacity-40"
                >
                  {status?.screenTimeoutMs === undefined && <option value={0}>Unavailable</option>}
                  {status?.screenTimeoutMs !== undefined && !screenTimeoutActions[status.screenTimeoutMs] && (
                    <option value={status.screenTimeoutMs}>{Math.round(status.screenTimeoutMs / 1000)} seconds</option>
                  )}
                  {screenTimeoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Switch checked={config.turnOff || false} onChange={(value) => onUpdateConfig('turnOff', value)} label="Turn Device Screen Off" />
            </section>

            <section className="border-t border-[var(--border-subtle)] pt-4">
              <h2 className="mb-2 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">Performance</h2>
              <Switch checked={config.vsync !== false} onChange={(value) => onUpdateConfig('vsync', value)} label="VSync" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[8px] uppercase tracking-wide text-[var(--text-subtle)]">
                  FPS Limit
                  <select value={config.fps || 0} onChange={(event) => onUpdateConfig('fps', Number(event.target.value) || undefined)} className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] normal-case text-[var(--text-base)] outline-none focus:border-primary">
                    <option value={0}>Auto</option>
                    {[30, 60, 90, 120].map((fps) => <option key={fps} value={fps}>{fps}</option>)}
                  </select>
                </label>
                <label className="text-[8px] uppercase tracking-wide text-[var(--text-subtle)]">
                  Bitrate
                  <select value={config.bitrate || 8} onChange={(event) => onUpdateConfig('bitrate', Number(event.target.value))} className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] normal-case text-[var(--text-base)] outline-none focus:border-primary">
                    {[2, 4, 8, 12, 16].map((value) => <option key={value} value={value}>{value} Mbps</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className="border-t border-[var(--border-subtle)] pt-4">
              <h2 className="mb-2 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">Audio</h2>
              <Switch checked={config.audioEnabled !== false} onChange={(value) => onUpdateConfig('audioEnabled', value)} label="Forward Audio" />
              <label className="mt-2 block text-[8px] uppercase tracking-wide text-[var(--text-subtle)]">
                Audio Codec
                <select value={config.audioCodec || 'auto'} onChange={(event) => onUpdateConfig('audioCodec', event.target.value)} disabled={config.audioEnabled === false} className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] normal-case text-[var(--text-base)] outline-none focus:border-primary disabled:opacity-40">
                  {['auto', 'opus', 'aac', 'flac', 'raw'].map((codec) => <option key={codec} value={codec}>{codec === 'auto' ? 'Auto' : codec.toUpperCase()}</option>)}
                </select>
              </label>
            </section>
          </div>
        )}

        {activeTab === 'inspector' && (
          <div>
            <h2 className="mb-3 text-[9px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">Active Device</h2>
            {infoRows.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2 text-[9px]">
                <span className="text-[var(--text-subtle)]">{label}</span>
                <span className="min-w-0 truncate text-right text-[var(--text-muted)]">{value || '—'}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <p className="text-[10px] leading-relaxed text-[var(--text-subtle)]">Advanced launch, input, codec and window options are available in Session Settings.</p>
            <button type="button" onClick={onOpenSettings} className={`flex items-center gap-1.5 text-[10px] font-medium text-primary hover:underline ${focusRing}`}>
              <Settings size={12} /> Open advanced settings
            </button>
          </div>
        )}

        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <button type="button" onClick={isRunning ? onStop : onStart} disabled={!activeDevice} className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[10px] font-semibold disabled:opacity-35 ${focusRing} ${isRunning ? 'border border-red-500/35 bg-red-500/15 text-red-400' : 'bg-primary text-on-primary hover:bg-[var(--primary-hover)]'}`}>
            <CirclePower size={13} /> {isRunning ? 'Stop Session' : 'Start Session'}
          </button>
        </div>
      </div>
    </section>
  )
}
