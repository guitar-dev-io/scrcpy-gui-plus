import { describe, expect, it } from 'vitest'
import { resolveAutomationTarget } from './automationTargetService'
import type { AutomationTargetContext } from '../types/automationTarget'

const context: AutomationTargetContext = {
  currentDeviceId: 'pixel-current',
  selectedDeviceIds: ['pixel-a', 'pixel-b', 'pixel-a'],
  availableDeviceIds: ['pixel-current', 'pixel-a', 'group-online'],
  groups: [
    {
      id: 'qa',
      name: 'QA Lab',
      deviceIds: ['group-online', 'group-offline', 'group-online'],
    },
    { id: 'empty', name: 'Empty rack', deviceIds: [] },
  ],
}

describe('resolveAutomationTarget', () => {
  it('resolves the current device to an explicit serial', () => {
    expect(resolveAutomationTarget({ mode: 'current' }, context)).toMatchObject({
      requestedSerials: ['pixel-current'],
      serials: ['pixel-current'],
      unavailableSerials: [],
      isValid: true,
    })
  })

  it('deduplicates selected devices and skips unavailable targets', () => {
    expect(resolveAutomationTarget({ mode: 'selected' }, context)).toMatchObject({
      requestedSerials: ['pixel-a', 'pixel-b'],
      serials: ['pixel-a'],
      unavailableSerials: ['pixel-b'],
      isValid: true,
      warning: { code: 'targets-unavailable' },
    })
  })

  it('resolves a dynamic device group by id', () => {
    expect(
      resolveAutomationTarget({ mode: 'group', groupId: 'qa' }, context),
    ).toMatchObject({
      requestedSerials: ['group-online', 'group-offline'],
      serials: ['group-online'],
      unavailableSerials: ['group-offline'],
      isValid: true,
    })
  })

  it.each([
    [
      { mode: 'current' } as const,
      { ...context, currentDeviceId: null },
      'no-current-device',
    ],
    [
      { mode: 'selected' } as const,
      { ...context, selectedDeviceIds: [] },
      'no-selected-devices',
    ],
    [
      { mode: 'group', groupId: '' } as const,
      context,
      'group-required',
    ],
    [
      { mode: 'group', groupId: 'missing' } as const,
      context,
      'group-not-found',
    ],
    [
      { mode: 'group', groupId: 'empty' } as const,
      context,
      'empty-group',
    ],
    [
      { mode: 'current' } as const,
      { ...context, currentDeviceId: 'offline' },
      'targets-unavailable',
    ],
  ])('returns validation issue %s', (target, targetContext, issueCode) => {
    const result = resolveAutomationTarget(target, targetContext)
    expect(result.isValid).toBe(false)
    expect(result.serials).toEqual([])
    expect(result.error?.code).toBe(issueCode)
  })
})
