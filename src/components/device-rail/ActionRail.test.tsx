import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Camera, Home, Play } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import ActionRail, { type RailGroup } from './ActionRail'

function groups(onHome = vi.fn(), onRecord = vi.fn()): RailGroup[] {
  return [
    {
      label: 'Quick actions',
      actions: [
        { id: 'screenshot', label: 'Screenshot', icon: Camera, onClick: vi.fn() },
        {
          id: 'record',
          label: 'Record',
          icon: Play,
          onClick: onRecord,
          disabled: true,
        },
      ],
    },
    {
      label: 'Navigation',
      actions: [{ id: 'home', label: 'Home', icon: Home, onClick: onHome }],
    },
    { label: 'Empty', actions: [] },
  ]
}

describe('ActionRail', () => {
  it('names every action for assistive tech while collapsed to icons', () => {
    render(<ActionRail ariaLabel="Device actions" groups={groups()} />)

    expect(screen.getByRole('navigation', { name: 'Device actions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Screenshot' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Quick actions' })).toBeInTheDocument()
    // Labels are tooltips only until the rail is expanded.
    expect(screen.queryByText('Screenshot')).toBeNull()
    // A group with nothing available draws no divider.
    expect(screen.queryByRole('group', { name: 'Empty' })).toBeNull()
  })

  it('shows the labels once expanded', () => {
    render(
      <ActionRail ariaLabel="Device actions" groups={groups()} expanded />,
    )

    expect(screen.getByText('Screenshot')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('runs enabled actions and holds back disabled ones', async () => {
    const user = userEvent.setup()
    const onHome = vi.fn()
    const onRecord = vi.fn()
    render(
      <ActionRail ariaLabel="Device actions" groups={groups(onHome, onRecord)} />,
    )

    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(onHome).toHaveBeenCalledOnce()

    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('offers the expand toggle only when the caller owns that state', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()
    const { rerender } = render(
      <ActionRail ariaLabel="Device actions" groups={groups()} />,
    )
    expect(screen.queryByRole('button', { name: /action rail/i })).toBeNull()

    rerender(
      <ActionRail
        ariaLabel="Device actions"
        groups={groups()}
        onToggleExpanded={onToggleExpanded}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Expand action rail' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })
})
