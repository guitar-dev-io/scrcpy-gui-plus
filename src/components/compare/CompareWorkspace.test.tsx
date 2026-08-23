import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompareWorkspace from './CompareWorkspace'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const history = [
  { id: 'a', path: '/a.png', filename: 'a.png', deviceSerial: 'a', deviceName: 'Pixel A', capturedAt: '2026-08-23T00:00:00Z' },
  { id: 'b', path: '/b.png', filename: 'b.png', deviceSerial: 'b', deviceName: 'Pixel B', capturedAt: '2026-08-23T00:00:01Z' },
]
const sessions = [{
  id: 'session',
  name: 'Compare session',
  createdAt: '2026-08-23T00:00:02Z',
  screenshotIds: ['a', 'b'],
  referenceScreenshotId: 'a',
}]

describe('CompareWorkspace', () => {
  it('renders session members and changes the reference', () => {
    const onSetReference = vi.fn()
    const onRecapture = vi.fn()
    const onOpenDevice = vi.fn()
    const onOpenLogcat = vi.fn()
    render(<CompareWorkspace sessions={sessions} history={history} onSetReference={onSetReference} onDeleteSession={vi.fn()} onRecapture={onRecapture} onOpenDevice={onOpenDevice} onOpenLogcat={onOpenLogcat} />)
    expect(screen.getByAltText('a.png')).toBeInTheDocument()
    expect(screen.getByAltText('b.png')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reference screenshot'), { target: { value: 'b' } })
    expect(onSetReference).toHaveBeenCalledWith('session', 'b')
    fireEvent.click(screen.getByLabelText('Zoom in'))
    expect(screen.getByRole('button', { name: '125%' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByLabelText('Recapture Pixel A'))
    expect(onRecapture).toHaveBeenCalledWith('session', history[0])
    fireEvent.click(screen.getByLabelText('Open device a'))
    expect(onOpenDevice).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByLabelText('Open Logcat for a'))
    expect(onOpenLogcat).toHaveBeenCalledWith('a')
  })

  it('deletes only the active lightweight session', () => {
    const onDeleteSession = vi.fn()
    render(<CompareWorkspace sessions={sessions} history={history} onSetReference={vi.fn()} onDeleteSession={onDeleteSession} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }))
    expect(onDeleteSession).toHaveBeenCalledWith('session')
  })

  it('switches to configurable overlay and difference modes', () => {
    render(<CompareWorkspace sessions={sessions} history={history} onSetReference={vi.fn()} onDeleteSession={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Compare view mode'), { target: { value: 'overlay' } })
    expect(screen.getByAltText('Reference a.png')).toBeInTheDocument()
    expect(screen.getByAltText('Overlay b.png')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Overlay opacity'), { target: { value: '25' } })
    expect(screen.getByText(/25%/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Compare view mode'), { target: { value: 'difference' } })
    expect(screen.getByLabelText('Pixel threshold')).toHaveValue(16)
  })
})
