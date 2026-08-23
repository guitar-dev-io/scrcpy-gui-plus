import { useEffect, useMemo } from 'react'
import { useDeviceGroups } from '../../hooks/useDeviceGroups'
import { resolveAutomationTarget } from '../../services/automationTargetService'
import type {
  AutomationTarget,
  AutomationTargetMode,
  AutomationTargetResolution,
} from '../../types/automationTarget'

interface AutomationTargetSelectorProps {
  value: AutomationTarget
  onChange: (target: AutomationTarget) => void
  currentDeviceId?: string | null
  selectedDeviceIds: readonly string[] | ReadonlySet<string>
  availableDeviceIds: readonly string[] | ReadonlySet<string>
  disabled?: boolean
  storage?: Storage
  className?: string
  onResolutionChange?: (resolution: AutomationTargetResolution) => void
}

export default function AutomationTargetSelector({
  value,
  onChange,
  currentDeviceId,
  selectedDeviceIds,
  availableDeviceIds,
  disabled = false,
  storage,
  className = '',
  onResolutionChange,
}: AutomationTargetSelectorProps) {
  const { groups } = useDeviceGroups(storage)
  const resolution = useMemo(
    () =>
      resolveAutomationTarget(value, {
        currentDeviceId,
        selectedDeviceIds,
        groups,
        availableDeviceIds,
      }),
    [availableDeviceIds, currentDeviceId, groups, selectedDeviceIds, value],
  )

  useEffect(() => {
    onResolutionChange?.(resolution)
  }, [onResolutionChange, resolution])

  const emitTarget = (target: AutomationTarget) => {
    onChange(target)
  }

  const handleModeChange = (mode: AutomationTargetMode) => {
    if (mode === 'group') {
      emitTarget({ mode, groupId: groups[0]?.id ?? '' })
      return
    }
    emitTarget({ mode })
  }

  const selectedCount = Array.from(selectedDeviceIds).length
  const fieldClass =
    'h-9 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] px-2.5 text-[10px] text-[var(--text-base)] outline-none transition-colors focus-visible:border-primary/55 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45'

  return (
    <fieldset
      className={`rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] p-3 ${className}`}
      disabled={disabled}
    >
      <legend className="px-1 text-[10px] font-semibold text-[var(--text-base)]">
        Device targets
      </legend>

      <label className="block text-[9px] font-medium text-[var(--text-muted)]">
        Automation target
        <select
          aria-label="Automation target"
          className={`${fieldClass} mt-1`}
          value={value.mode}
          onChange={(event) =>
            handleModeChange(event.target.value as AutomationTargetMode)
          }
        >
          <option value="current">
            Current device{currentDeviceId ? ` — ${currentDeviceId}` : ''}
          </option>
          <option value="selected">Selected devices — {selectedCount}</option>
          <option value="group">Device group</option>
        </select>
      </label>

      {value.mode === 'group' && (
        <label className="mt-2 block text-[9px] font-medium text-[var(--text-muted)]">
          Device group
          <select
            aria-label="Device group"
            className={`${fieldClass} mt-1`}
            value={value.groupId}
            onChange={(event) =>
              emitTarget({ mode: 'group', groupId: event.target.value })
            }
            disabled={disabled || groups.length === 0}
          >
            {groups.length === 0 && <option value="">No device groups</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} — {group.deviceIds.length}
              </option>
            ))}
          </select>
        </label>
      )}

      {resolution.error ? (
        <p role="alert" className="mt-2 text-[9px] text-red-400">
          {resolution.error.message}
        </p>
      ) : (
        <div className="mt-2" role="status" aria-live="polite">
          <p className="text-[9px] text-[var(--text-subtle)]">
            {resolution.serials.length} available{' '}
            {resolution.serials.length === 1 ? 'device' : 'devices'}
          </p>
          {resolution.warning && (
            <p className="mt-0.5 text-[9px] text-amber-400">
              {resolution.warning.message}
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}

export type { AutomationTargetSelectorProps }
