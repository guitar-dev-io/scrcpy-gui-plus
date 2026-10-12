import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { QrDestination } from './destinations'
import QrStudioHeader from './QrStudioHeader'

function Harness({
  containerWidth = 1400,
  devices = [],
  activeDevice = '',
  deviceMeta,
}: {
  containerWidth?: number
  devices?: string[]
  activeDevice?: string
  deviceMeta?: Record<string, { androidVersion?: string; connection?: string; battery?: number }>
}) {
  const [destination, setDestination] = useState<QrDestination>('create')
  return (
    <QrStudioHeader
      destination={destination}
      onSelectDestination={setDestination}
      containerWidth={containerWidth}
      savedCount={3}
      linkCount={1}
      devices={devices}
      deviceLabels={{ s1: 'Pixel 7' }}
      deviceMeta={deviceMeta}
      activeDevice={activeDevice}
      onSelectDevice={vi.fn()}
    />
  )
}

const tabs = () => screen.getAllByRole('tab')

describe('QrStudioHeader nav cards', () => {
  it('renders five numbered tabs in one tablist with subtitles', () => {
    render(<Harness />)
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(tabs().map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Create',
      'Templates',
      'Device Actions',
      'Tools',
      'Library',
    ])
    expect(tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(screen.getAllByTestId('qr-nav-number').map((node) => node.textContent)).toEqual(['1', '2', '3', '4', '5'])
    for (const subtitle of [
      'Generate QR codes',
      'Predefined styles',
      'Test on connected device',
      'Scan · Validate · Convert',
      'Manage & organize',
    ]) {
      expect(screen.getByText(subtitle)).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAccessibleDescription('Scan · Validate · Convert')
  })

  it('moves selection and focus with arrow, Home and End keys, wrapping at the ends', () => {
    render(<Harness />)
    const [create, templates, , , library] = tabs()
    expect(create).toHaveAttribute('tabindex', '0')
    expect(templates).toHaveAttribute('tabindex', '-1')
    create.focus()
    fireEvent.keyDown(create, { key: 'ArrowRight' })
    expect(templates).toHaveAttribute('aria-selected', 'true')
    expect(templates).toHaveFocus()
    expect(templates).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(templates, { key: 'ArrowLeft' })
    fireEvent.keyDown(create, { key: 'ArrowLeft' })
    expect(library).toHaveAttribute('aria-selected', 'true')
    expect(library).toHaveFocus()
    fireEvent.keyDown(library, { key: 'Home' })
    expect(create).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(create, { key: 'End' })
    expect(library).toHaveAttribute('aria-selected', 'true')
  })

  it('selects a card on click', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Device Actions' }))
    expect(screen.getByRole('tab', { name: 'Device Actions' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps all five tabs by name in a compact container', () => {
    render(<Harness containerWidth={1100} />)
    expect(screen.getByRole('tablist')).toHaveAttribute('data-compact', 'true')
    expect(tabs()).toHaveLength(5)
    expect(screen.getByRole('tab', { name: 'Library' })).toBeInTheDocument()
  })

  it('shows the title, subtitle and counters on the header row', () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'QR Studio' })).toBeInTheDocument()
    expect(screen.getByText('Create, test and deploy QR codes for mobile development')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Links')).toBeInTheDocument()
  })
})

describe('QrStudioHeader device card', () => {
  it('shows a Connected badge and meta only when the data exists', () => {
    const { unmount } = render(<Harness devices={['s1']} activeDevice="s1" deviceMeta={{ s1: { androidVersion: '14', connection: 'USB', battery: 82 } }} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Android 14 · USB · 82%')).toBeInTheDocument()
    unmount()
    render(<Harness devices={['s1']} activeDevice="s1" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByText(/Android \d/)).not.toBeInTheDocument()
  })

  it('shows the no-device placeholder and no badge without a device', () => {
    render(<Harness />)
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Target device' })).toHaveTextContent('No device connected')
  })
})
