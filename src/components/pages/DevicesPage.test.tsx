import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DevicesPage from './DevicesPage'

describe('DevicesPage iOS integration', () => {
  it('shows a detected iPhone as a real view-only workspace target', () => {
    const iphone = {
      udid: 'ios-udid',
      name: 'Anuwat iPhone',
      productType: 'iPhone15,2',
      productVersion: '17.6',
      connectionType: 'USB',
    }
    const onViewIos = vi.fn()
    render(
      <DevicesPage
        devices={[]}
        activeDevice=""
        runningDevices={[]}
        isRefreshing={false}
        onRefresh={vi.fn()}
        onAddDevice={vi.fn()}
        onSelectDevice={vi.fn()}
        onView={vi.fn()}
        onControl={vi.fn()}
        onFile={vi.fn()}
        onShell={vi.fn()}
        onMore={vi.fn()}
        connectionTools={null}
        iosReady
        iosDevices={[iphone]}
        onViewIos={onViewIos}
      />,
    )

    expect(screen.getByText('1 connected device')).toBeInTheDocument()
    expect(screen.getByText('Anuwat iPhone')).toBeInTheDocument()
    expect(screen.getByText('View-only developer stream')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }))
    expect(onViewIos).toHaveBeenCalledWith(iphone)
  })
})
