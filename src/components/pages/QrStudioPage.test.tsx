import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from '../../services/deepLinkService'
import { QR_STUDIO_STORAGE_KEY } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE } from '../../types/qrStudio'
import QrStudioPage from './QrStudioPage'

vi.mock('../../services/deepLinkService', () => ({
  generateQrSvg: vi.fn(),
}))

const generateQrSvgMock = vi.mocked(generateQrSvg)
const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'

describe('QrStudioPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    generateQrSvgMock.mockReset()
    generateQrSvgMock.mockResolvedValue(svg)
  })

  it('creates and persists a single QR code', async () => {
    render(<QrStudioPage />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Campaign' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'https://example.com/campaign' } })
    fireEvent.click(screen.getByRole('button', { name: /Create QR Code/i }))

    expect(await screen.findByText('Campaign')).toBeInTheDocument()
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(QR_STUDIO_STORAGE_KEY) || '[]')
      expect(saved).toHaveLength(1)
      expect(saved[0].content).toBe('https://example.com/campaign')
    })
  })

  it('creates multiple named QR codes from line input', async () => {
    render(<QrStudioPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Multi create' }))
    fireEvent.change(screen.getByLabelText(/One QR code per line/), {
      target: { value: 'Docs | https://example.com/docs\nSupport | mailto:help@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create 2 QR codes' }))

    expect(await screen.findByText('Docs')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(generateQrSvgMock).toHaveBeenCalledWith('https://example.com/docs', 'M')
    expect(generateQrSvgMock).toHaveBeenCalledWith('mailto:help@example.com', 'M')
  })

  it('can cancel editing a saved QR code', async () => {
    window.localStorage.setItem(QR_STUDIO_STORAGE_KEY, JSON.stringify([{
      id: 'saved-qr',
      name: 'Saved website',
      content: 'https://saved.example.com',
      contentType: 'url',
      svg,
      style: DEFAULT_QR_STYLE,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }]))
    render(<QrStudioPage />)

    fireEvent.click(screen.getByTitle('More actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(screen.getByText('Editing saved QR code')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Saved website')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(screen.queryByText('Editing saved QR code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('provides an explicit way back to the dashboard', () => {
    const onExit = vi.fn()
    render(<QrStudioPage onExit={onExit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to Dashboard' }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('warns when QR colors have insufficient contrast', () => {
    render(<QrStudioPage />)

    fireEvent.change(screen.getByLabelText(/Foreground/), {
      target: { value: '#ffffff' },
    })
    expect(
      screen.getByText(/Increase the difference between foreground and background/i),
    ).toBeInTheDocument()
  })
})
