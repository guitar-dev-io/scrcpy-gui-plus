import { describe, expect, it } from 'vitest'
import { deviceConnectionPresentation } from './deviceConnectionPresentation'

describe('device connection presentation', () => {
  it('provides actionable unauthorized and disconnected guidance', () => {
    expect(deviceConnectionPresentation('unauthorized')).toMatchObject({
      label: 'Unauthorized',
      actionLabel: 'Check again',
    })
    expect(deviceConnectionPresentation('disconnected')).toMatchObject({
      label: 'Disconnected',
      actionLabel: 'Refresh',
    })
  })

  it('includes bounded recovery progress', () => {
    expect(deviceConnectionPresentation('reconnecting', 2, 3).message).toContain(
      'attempt 2 of 3',
    )
  })
})
