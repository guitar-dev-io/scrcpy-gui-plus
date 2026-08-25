import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from '../../services/deepLinkService'
import { QR_STUDIO_STORAGE_KEY } from '../../services/qrStudioService'
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
})
