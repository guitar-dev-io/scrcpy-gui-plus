import { useState, type ReactNode } from 'react'
import {
  BatteryLow,
  Camera,
  Gauge,
  Moon,
  RefreshCw,
  RotateCcw,
  Type,
} from 'lucide-react'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import { Badge, Button, Panel, SectionHeader } from '../ui'
import { classNames } from '../ui/classNames'
import { useDeviceConditions } from '../../hooks/useDeviceConditions'
import {
  BATTERY_LEVEL_PRESETS,
  FONT_SCALE_OPTIONS,
  NIGHT_MODE_OPTIONS,
  batteryPowerSource,
  countActiveOverrides,
  densityPresets,
  parseDensityInput,
  sameFontScale,
  type DeviceConditionChange,
  type OnOff,
} from '../../types/deviceConditions'

export interface DeviceConditionsPanelProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  /** Online devices selected in the workspace; offered as a fan-out target. */
  selectedDeviceIds?: readonly string[]
  confirmAction?: (title: string, message: string, onConfirm: () => void) => void
}

interface ChoiceProps {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}

function Choice({ label, active, disabled, onClick }: ChoiceProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        'min-h-8 rounded-[var(--radius-control)] border px-3 py-1.5 text-[var(--font-size-label)] font-bold transition-colors disabled:opacity-40',
        active
          ? 'border-primary/60 bg-primary/15 text-primary'
          : 'border-[var(--border-base)] bg-[var(--bg-input)] text-[var(--text-muted)] hover:border-primary/40 hover:text-[var(--text-base)]',
      )}
    >
      {label}
    </button>
  )
}

interface ToggleRowProps {
  label: string
  hint: string
  checked: boolean | null
  disabled?: boolean
  onChange: (next: boolean) => void
  unknownLabel: string
}

function ToggleRow({ label, hint, checked, disabled, onChange, unknownLabel }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[var(--font-size-body-sm)] font-semibold text-[var(--text-base)]">{label}</div>
        <div className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{hint}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {checked == null && <Badge>{unknownLabel}</Badge>}
        <button
          type="button"
          role="switch"
          aria-label={label}
          aria-checked={checked === true}
          disabled={disabled}
          onClick={() => onChange(!(checked === true))}
          className={classNames(
            'relative h-6 w-11 rounded-full border transition-colors disabled:opacity-40',
            checked ? 'border-primary/60 bg-primary/70' : 'border-[var(--border-base)] bg-[var(--bg-input)]',
          )}
        >
          <span
            className={classNames(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]',
              checked ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>
    </div>
  )
}

function Card({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Panel className="flex flex-col gap-3" aria-label={title} role="region">
      <SectionHeader title={title} description={description} icon={icon} />
      {children}
    </Panel>
  )
}

export default function DeviceConditionsPanel({
  activeDevice,
  customPath,
  notify,
  selectedDeviceIds = [],
  confirmAction,
}: DeviceConditionsPanelProps) {
  const { t } = useI18n()
  const { conditions, loading, loadError, pending, demoMode, refresh, apply } = useDeviceConditions(
    activeDevice,
    customPath,
  )
  const [densityInput, setDensityInput] = useState('')
  const [applyToSelected, setApplyToSelected] = useState(false)

  const canFanOut = selectedDeviceIds.length > 1
  const targets = canFanOut && applyToSelected ? selectedDeviceIds : []
  const busy = pending !== null
  const disabled = !activeDevice || busy
  const onOff = (value: boolean): OnOff => (value ? 'on' : 'off')

  const run = async (change: DeviceConditionChange, label: string) => {
    const outcome = await apply(change, targets)
    if (outcome.ok) {
      notify(
        t('deviceConditions.appliedTitle'),
        outcome.total > 1
          ? t('deviceConditions.appliedMany', { label, count: outcome.total })
          : t('deviceConditions.applied', { label }),
        'success',
      )
    } else {
      notify(
        t('deviceConditions.failedTitle'),
        outcome.total > 1
          ? t('deviceConditions.failedMany', {
              label,
              failed: outcome.failed,
              count: outcome.total,
              error: outcome.error ?? '',
            })
          : t('deviceConditions.failed', { label, error: outcome.error ?? '' }),
        'error',
      )
    }
  }

  const resetAll = () => {
    const go = () => void run({ condition: 'reset_all' }, t('deviceConditions.resetAll'))
    if (confirmAction) {
      confirmAction(t('deviceConditions.resetAll'), t('deviceConditions.resetAllConfirm'), go)
    } else {
      go()
    }
  }

  if (!activeDevice) {
    return (
      <Panel className="text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">
        {t('deviceConditions.noDevice')}
      </Panel>
    )
  }

  const unknown = t('deviceConditions.unknown')
  const overrides = countActiveOverrides(conditions)
  const presets = densityPresets(conditions?.physicalDensity)
  const currentDensity = conditions?.overrideDensity ?? conditions?.physicalDensity ?? null
  const customDensity = parseDensityInput(densityInput)
  const battery = conditions?.battery ?? null

  return (
    <div className="flex flex-col gap-4">
      <Panel padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="accent">{activeDevice}</Badge>
          {overrides > 0 ? (
            <Badge tone="warning">{t('deviceConditions.overridesActive', { count: overrides })}</Badge>
          ) : (
            conditions && <Badge tone="success">{t('deviceConditions.stock')}</Badge>
          )}
          {canFanOut && (
            <label className="flex items-center gap-2 text-[var(--font-size-label)] text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={applyToSelected}
                onChange={(event) => setApplyToSelected(event.target.checked)}
              />
              {t('deviceConditions.applyToSelected', { count: selectedDeviceIds.length })}
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || busy}
            leadingIcon={<RefreshCw size={13} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />}
          >
            {t('deviceConditions.refresh')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={resetAll}
            disabled={disabled}
            leadingIcon={<RotateCcw size={13} aria-hidden="true" />}
          >
            {t('deviceConditions.resetAll')}
          </Button>
        </div>
      </Panel>

      {loadError && (
        <div role="alert" className="rounded-[var(--radius-control)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[var(--font-size-label)] text-red-400">
          {t('deviceConditions.loadFailed', { error: loadError })}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title={t('deviceConditions.appearance.title')}
          description={t('deviceConditions.appearance.description')}
          icon={<Moon size={14} aria-hidden="true" />}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('deviceConditions.appearance.nightMode')}>
            {NIGHT_MODE_OPTIONS.map((mode) => (
              <Choice
                key={mode}
                label={t(`deviceConditions.appearance.${mode}`)}
                active={conditions?.nightMode === mode}
                disabled={disabled}
                onClick={() =>
                  void run({ condition: 'night_mode', value: mode }, t(`deviceConditions.appearance.${mode}`))
                }
              />
            ))}
          </div>
          <p className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">
            {t('deviceConditions.appearance.current', { value: conditions?.nightMode ?? unknown })}
          </p>
        </Card>

        <Card
          title={t('deviceConditions.display.title')}
          description={t('deviceConditions.display.description')}
          icon={<Type size={14} aria-hidden="true" />}
        >
          <div>
            <div className="mb-2 text-[var(--font-size-label)] font-semibold text-[var(--text-muted)]">
              {t('deviceConditions.display.fontScale')}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('deviceConditions.display.fontScale')}>
              {FONT_SCALE_OPTIONS.map((scale) => (
                <Choice
                  key={scale}
                  label={`${scale}×`}
                  active={sameFontScale(conditions?.fontScale, scale)}
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      { condition: 'font_scale', value: scale },
                      t('deviceConditions.display.fontScaleValue', { value: scale }),
                    )
                  }
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[var(--font-size-label)] font-semibold text-[var(--text-muted)]">
              {t('deviceConditions.display.density')}
              <span className="font-normal text-[var(--text-subtle)]">
                {t('deviceConditions.display.densityCurrent', {
                  physical: conditions?.physicalDensity ?? unknown,
                  current: currentDensity ?? unknown,
                })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('deviceConditions.display.density')}>
              {presets.map((dpi) => (
                <Choice
                  key={dpi}
                  label={`${dpi}`}
                  active={currentDensity === dpi}
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      dpi === conditions?.physicalDensity
                        ? { condition: 'density', value: 'reset' }
                        : { condition: 'density', value: String(dpi) },
                      t('deviceConditions.display.densityValue', { value: dpi }),
                    )
                  }
                />
              ))}
              <input
                type="text"
                inputMode="numeric"
                value={densityInput}
                onChange={(event) => setDensityInput(event.target.value)}
                placeholder={t('deviceConditions.display.customDpi')}
                aria-label={t('deviceConditions.display.customDpi')}
                className="h-8 w-24 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[var(--font-size-label)] text-[var(--text-base)]"
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled || customDensity == null}
                onClick={() => {
                  if (customDensity == null) return
                  void run(
                    { condition: 'density', value: String(customDensity) },
                    t('deviceConditions.display.densityValue', { value: customDensity }),
                  )
                }}
              >
                {t('deviceConditions.set')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || conditions?.overrideDensity == null}
                onClick={() =>
                  void run({ condition: 'density', value: 'reset' }, t('deviceConditions.display.densityReset'))
                }
              >
                {t('deviceConditions.display.densityReset')}
              </Button>
            </div>
          </div>
        </Card>

        <Card
          title={t('deviceConditions.battery.title')}
          description={t('deviceConditions.battery.description')}
          icon={<BatteryLow size={14} aria-hidden="true" />}
        >
          <div className="flex flex-wrap items-center gap-2 text-[var(--font-size-label)] text-[var(--text-muted)]">
            <span>
              {t('deviceConditions.battery.current', {
                level: battery?.level ?? unknown,
                source: battery ? t(`deviceConditions.battery.source.${batteryPowerSource(battery)}`) : unknown,
              })}
            </span>
            {battery?.overridden && <Badge tone="warning">{t('deviceConditions.battery.simulated')}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('deviceConditions.battery.level')}>
            {BATTERY_LEVEL_PRESETS.map((level) => (
              <Choice
                key={level}
                label={`${level}%`}
                active={battery?.overridden === true && battery.level === level}
                disabled={disabled}
                onClick={() =>
                  void run(
                    { condition: 'battery_level', value: String(level) },
                    t('deviceConditions.battery.levelValue', { value: level }),
                  )
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => void run({ condition: 'battery_unplug' }, t('deviceConditions.battery.unplug'))}
            >
              {t('deviceConditions.battery.unplug')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => void run({ condition: 'battery_reset' }, t('deviceConditions.battery.reset'))}
            >
              {t('deviceConditions.battery.reset')}
            </Button>
          </div>
        </Card>

        <Card
          title={t('deviceConditions.statusBar.title')}
          description={t('deviceConditions.statusBar.description')}
          icon={<Camera size={14} aria-hidden="true" />}
        >
          <div className="flex flex-wrap items-center gap-2">
            {demoMode && <Badge tone="accent">{t('deviceConditions.statusBar.active')}</Badge>}
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => void run({ condition: 'demo_mode', value: 'on' }, t('deviceConditions.statusBar.enter'))}
            >
              {t('deviceConditions.statusBar.enter')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => void run({ condition: 'demo_mode', value: 'off' }, t('deviceConditions.statusBar.exit'))}
            >
              {t('deviceConditions.statusBar.exit')}
            </Button>
          </div>
          <p className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{t('deviceConditions.statusBar.note')}</p>
        </Card>

        <Card
          title={t('deviceConditions.testing.title')}
          description={t('deviceConditions.testing.description')}
          icon={<Gauge size={14} aria-hidden="true" />}
        >
          <div className="divide-y divide-[var(--border-subtle)]">
            <ToggleRow
              label={t('deviceConditions.testing.animations')}
              hint={t('deviceConditions.testing.animationsHint')}
              checked={conditions ? conditions.animationsEnabled : null}
              disabled={disabled}
              unknownLabel={unknown}
              onChange={(next) =>
                void run({ condition: 'animations', value: onOff(next) }, t('deviceConditions.testing.animations'))
              }
            />
            <ToggleRow
              label={t('deviceConditions.testing.showTouches')}
              hint={t('deviceConditions.testing.showTouchesHint')}
              checked={conditions ? conditions.showTouches : null}
              disabled={disabled}
              unknownLabel={unknown}
              onChange={(next) =>
                void run({ condition: 'show_touches', value: onOff(next) }, t('deviceConditions.testing.showTouches'))
              }
            />
            <ToggleRow
              label={t('deviceConditions.testing.pointerLocation')}
              hint={t('deviceConditions.testing.pointerLocationHint')}
              checked={conditions ? conditions.pointerLocation : null}
              disabled={disabled}
              unknownLabel={unknown}
              onChange={(next) =>
                void run(
                  { condition: 'pointer_location', value: onOff(next) },
                  t('deviceConditions.testing.pointerLocation'),
                )
              }
            />
            <ToggleRow
              label={t('deviceConditions.testing.stayAwake')}
              hint={t('deviceConditions.testing.stayAwakeHint')}
              checked={conditions ? conditions.stayAwake : null}
              disabled={disabled}
              unknownLabel={unknown}
              onChange={(next) =>
                void run({ condition: 'stay_awake', value: onOff(next) }, t('deviceConditions.testing.stayAwake'))
              }
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
