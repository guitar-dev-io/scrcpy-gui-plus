import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShellUiProvider, useShellUi } from '../../contexts/ShellUiContext'
import RouteFamilyTabs from './RouteFamilyTabs'

function Harness() {
  const { activeRoute } = useShellUi()
  return (
    <>
      <RouteFamilyTabs route={activeRoute} />
      <output data-testid="route">{activeRoute}</output>
    </>
  )
}

describe('RouteFamilyTabs', () => {
  it('lists the family members and navigates between them', async () => {
    render(
      <ShellUiProvider initialRoute="devices" initialOpenWorkspaceTools={[]}>
        <Harness />
      </ShellUiProvider>,
    )

    expect(screen.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Live wall' }))
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('device-wall'))
    expect(screen.getByRole('tab', { name: 'Live wall' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps Connect Device out of the Devices tab strip', () => {
    // Connect has its own sidebar entry, so the page shows no family tabs.
    render(
      <ShellUiProvider initialRoute="pair-device" initialOpenWorkspaceTools={[]}>
        <Harness />
      </ShellUiProvider>,
    )
    expect(screen.queryByRole('tab', { name: 'Connect' })).not.toBeInTheDocument()
  })

  it('renders nothing outside a family', () => {
    render(
      <ShellUiProvider initialRoute="settings" initialOpenWorkspaceTools={[]}>
        <Harness />
      </ShellUiProvider>,
    )
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
