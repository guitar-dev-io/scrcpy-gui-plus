import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationTargetSelector from './AutomationTargetSelector'
import { DEVICE_GROUPS_KEY } from '../../types/deviceGroups'

describe('AutomationTargetSelector', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(
      DEVICE_GROUPS_KEY,
      JSON.stringify({
        version: 1,
        groups: [
          { id: 'qa', name: 'QA Lab', deviceIds: ['pixel-a', 'pixel-offline'] },
          { id: 'demo', name: 'Demo Rack', deviceIds: ['pixel-demo'] },
        ],
      }),
    )
  })

  it('switches modes and selects a dynamic group', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <AutomationTargetSelector
        value={{ mode: 'current' }}
        onChange={onChange}
        currentDeviceId="pixel-a"
        selectedDeviceIds={['pixel-a', 'pixel-demo']}
        availableDeviceIds={['pixel-a', 'pixel-demo']}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Automation target' }), {
      target: { value: 'group' },
    })
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'group', groupId: 'qa' })

    rerender(
      <AutomationTargetSelector
        value={{ mode: 'group', groupId: 'qa' }}
        onChange={onChange}
        currentDeviceId="pixel-a"
        selectedDeviceIds={['pixel-a', 'pixel-demo']}
        availableDeviceIds={['pixel-a', 'pixel-demo']}
      />,
    )
    expect(screen.getByRole('option', { name: 'QA Lab — 2' })).toBeInTheDocument()
    expect(screen.getByText('1 unavailable device will be skipped.')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Device group' }), {
      target: { value: 'demo' },
    })
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'group', groupId: 'demo' })
  })

  it('shows empty selection validation', () => {
    render(
      <AutomationTargetSelector
        value={{ mode: 'selected' }}
        onChange={vi.fn()}
        selectedDeviceIds={[]}
        availableDeviceIds={['pixel-a']}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Select at least one device before running this automation.',
    )
  })
})
