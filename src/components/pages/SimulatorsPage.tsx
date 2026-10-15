import { useEffect, useState } from 'react'
import {
  Apple,
  Boxes,
  RefreshCw,
  Smartphone,
} from 'lucide-react'
import SimulatorsPanel from '../simulators'
import PhysicalAndroidStage from '../simulators/PhysicalAndroidStage'
import IosWorkspaceStage from '../dashboard/IosWorkspaceStage'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'
import type { SimScreenshotResult, SimulatorDevice } from '../../types/simDeck'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

type DeviceSourceTab = 'simdeck' | 'android' | 'ios'

interface SimulatorsPageProps {
  notify: ToolbarNotifier
  customPath?: string
  screenshotDir?: string
  androidDevices?: string[]
  androidLabels?: Record<string, string>
  iosDevices?: IosDeviceInfo[]
  onScreenshotCaptured?: (
    result: SimScreenshotResult,
    device: SimulatorDevice,
  ) => void
  onRefreshAndroid?: () => void | Promise<void>
  onRefreshIos?: () => void | Promise<void>
  onOpenAndroid?: (serial: string) => void
  onOpenIos?: (device: IosDeviceInfo) => void
  onIosFrame?: (udid: string, frameSrc: string | null) => void
}

export default function SimulatorsPage({
  notify,
  customPath,
  screenshotDir,
  androidDevices = [],
  androidLabels = {},
  iosDevices = [],
  onScreenshotCaptured,
  onRefreshAndroid,
  onRefreshIos,
  onOpenAndroid,
  onOpenIos,
  onIosFrame,
}: SimulatorsPageProps) {
  const { t } = useI18n()
  const [source, setSource] = useState<DeviceSourceTab>('simdeck')
  const [androidSerial, setAndroidSerial] = useState('')
  const [iosUdid, setIosUdid] = useState('')
  const [refreshingPhysical, setRefreshingPhysical] = useState(false)

  useEffect(() => {
    if (!androidSerial || !androidDevices.includes(androidSerial)) {
      setAndroidSerial(androidDevices[0] || '')
    }
  }, [androidDevices, androidSerial])

  useEffect(() => {
    if (!iosUdid || !iosDevices.some((device) => device.udid === iosUdid)) {
      setIosUdid(iosDevices[0]?.udid || '')
    }
  }, [iosDevices, iosUdid])

  const refreshPhysical = async () => {
    if (refreshingPhysical) return
    setRefreshingPhysical(true)
    try {
      await Promise.all([onRefreshAndroid?.(), onRefreshIos?.()])
    } finally {
      setRefreshingPhysical(false)
    }
  }

  const activeIos = iosDevices.find((device) => device.udid === iosUdid) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="simulators"
          title={t('pages.deviceLab.title')}
          subtitle={t('pages.deviceLab.subtitle')}
        />

        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-1">
            <SourceButton
              active={source === 'simdeck'}
              icon={Boxes}
              label="SimDeck"
              count={undefined}
              onClick={() => setSource('simdeck')}
            />
            <SourceButton
              active={source === 'android'}
              icon={Smartphone}
              label="Android"
              count={androidDevices.length}
              onClick={() => setSource('android')}
            />
            <SourceButton
              active={source === 'ios'}
              icon={Apple}
              label="iPhone"
              count={iosDevices.length}
              onClick={() => setSource('ios')}
            />
          </div>
          {source !== 'simdeck' && (
            <button
              type="button"
              onClick={() => void refreshPhysical()}
              disabled={refreshingPhysical}
              title="Refresh physical devices"
              className="rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-2.5 text-[var(--text-subtle)] hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <RefreshCw
                size={14}
                className={refreshingPhysical ? 'animate-spin' : ''}
              />
            </button>
          )}
        </div>
      </header>

      <section aria-label="Device lab" className="mt-5 min-h-0 flex-1">
        {source === 'simdeck' ? (
          <SimulatorsPanel
            embedded
            isOpen={false}
            onClose={() => {}}
            customPath={customPath}
            screenshotDir={screenshotDir}
            notify={notify}
            onScreenshotCaptured={onScreenshotCaptured}
          />
        ) : source === 'android' ? (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <PhysicalDeviceSelect
              value={androidSerial}
              onChange={setAndroidSerial}
              placeholder="No physical Android device connected"
              options={androidDevices.map((serial) => ({
                value: serial,
                label: androidLabels[serial] || serial,
                detail: serial,
              }))}
            />
            {androidSerial ? (
              <PhysicalAndroidStage
                key={androidSerial}
                serial={androidSerial}
                name={androidLabels[androidSerial]}
                customPath={customPath}
                notify={notify}
                onOpenWorkspace={onOpenAndroid}
              />
            ) : (
              <EmptyPhysical platform="Android" />
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3">
            <PhysicalDeviceSelect
              value={iosUdid}
              onChange={setIosUdid}
              placeholder="No physical iPhone or iPad connected"
              options={iosDevices.map((device) => ({
                value: device.udid,
                label: device.name || device.productType,
                detail: `${device.connectionType || 'USB'} · iOS ${device.productVersion || 'Unknown'}`,
              }))}
            />
            {activeIos ? (
              <div className="min-h-[620px] flex-1 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/95">
                <IosWorkspaceStage
                  key={activeIos.udid}
                  device={activeIos}
                  customPath={customPath}
                  onFrame={(frameSrc) => onIosFrame?.(activeIos.udid, frameSrc)}
                />
                {onOpenIos && (
                  <button
                    type="button"
                    onClick={() => onOpenIos(activeIos)}
                    className="sr-only"
                  >
                    Open iOS workspace
                  </button>
                )}
              </div>
            ) : (
              <EmptyPhysical platform="iOS" />
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function SourceButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean
  icon: typeof Boxes
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[9px] font-bold transition-colors ${
        active
          ? 'bg-primary text-on-primary'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'
      }`}
    >
      <Icon size={13} /> {label}
      {count !== undefined && (
        <span className="rounded-full bg-black/15 px-1.5 text-[8px]">
          {count}
        </span>
      )}
    </button>
  )
}

function PhysicalDeviceSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string; detail: string }>
  placeholder: string
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] px-4 py-2.5">
      <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
        Physical device
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={options.length === 0}
        className="ml-auto min-w-64 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 py-2 text-[10px] font-semibold text-[var(--text-base)] outline-none focus:border-primary/50 disabled:opacity-50"
      >
        {options.length === 0 ? (
          <option value="">{placeholder}</option>
        ) : (
          options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} — {option.detail}
            </option>
          ))
        )}
      </select>
    </label>
  )
}

function EmptyPhysical({ platform }: { platform: string }) {
  return (
    <div className="flex min-h-[480px] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)] text-center">
      <Smartphone size={28} className="text-[var(--text-subtle)]" />
      <p className="mt-4 text-[11px] font-semibold text-[var(--text-base)]">
        No physical {platform} device detected
      </p>
      <p className="mt-1 max-w-md text-[9px] text-[var(--text-subtle)]">
        Connect a trusted device over USB or the configured wireless transport,
        then refresh.
      </p>
    </div>
  )
}
