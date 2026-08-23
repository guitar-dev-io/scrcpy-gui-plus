import type {
  AutomationTarget,
  AutomationTargetContext,
  AutomationTargetIssue,
  AutomationTargetResolution,
} from '../types/automationTarget'

function uniqueSerials(values: Iterable<string>): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const serial = value.trim()
    if (!serial || seen.has(serial)) continue
    seen.add(serial)
    result.push(serial)
  }

  return result
}

function invalidResolution(
  target: AutomationTarget,
  error: AutomationTargetIssue,
  requestedSerials: string[] = [],
  unavailableSerials: string[] = [],
): AutomationTargetResolution {
  return {
    target,
    requestedSerials,
    serials: [],
    unavailableSerials,
    isValid: false,
    error,
  }
}

/**
 * Resolves a durable target choice into the currently runnable ADB serials.
 * Mixed online/offline selections remain runnable and report the skipped
 * serials as a warning; a target with no available serials is invalid.
 */
export function resolveAutomationTarget(
  target: AutomationTarget,
  context: AutomationTargetContext,
): AutomationTargetResolution {
  let requestedSerials: string[]

  if (target.mode === 'current') {
    requestedSerials = uniqueSerials(
      context.currentDeviceId ? [context.currentDeviceId] : [],
    )
    if (requestedSerials.length === 0) {
      return invalidResolution(target, {
        code: 'no-current-device',
        message: 'Choose a current device before running this automation.',
      })
    }
  } else if (target.mode === 'selected') {
    requestedSerials = uniqueSerials(context.selectedDeviceIds)
    if (requestedSerials.length === 0) {
      return invalidResolution(target, {
        code: 'no-selected-devices',
        message: 'Select at least one device before running this automation.',
      })
    }
  } else {
    if (!target.groupId.trim()) {
      return invalidResolution(target, {
        code: 'group-required',
        message: 'Choose a device group before running this automation.',
      })
    }

    const group = context.groups.find((candidate) => candidate.id === target.groupId)
    if (!group) {
      return invalidResolution(target, {
        code: 'group-not-found',
        message: 'The selected device group no longer exists.',
      })
    }

    requestedSerials = uniqueSerials(group.deviceIds)
    if (requestedSerials.length === 0) {
      return invalidResolution(target, {
        code: 'empty-group',
        message: `${group.name} does not contain any devices.`,
      })
    }
  }

  const available = new Set(uniqueSerials(context.availableDeviceIds))
  const serials = requestedSerials.filter((serial) => available.has(serial))
  const unavailableSerials = requestedSerials.filter((serial) => !available.has(serial))

  if (serials.length === 0) {
    return invalidResolution(
      target,
      {
        code: 'targets-unavailable',
        message: 'None of the targeted devices are currently available.',
      },
      requestedSerials,
      unavailableSerials,
    )
  }

  return {
    target,
    requestedSerials,
    serials,
    unavailableSerials,
    isValid: true,
    warning:
      unavailableSerials.length > 0
        ? {
            code: 'targets-unavailable',
            message: `${unavailableSerials.length} unavailable ${
              unavailableSerials.length === 1 ? 'device will' : 'devices will'
            } be skipped.`,
          }
        : undefined,
  }
}
