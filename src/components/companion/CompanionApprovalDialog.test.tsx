import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompanionApprovalDialog from './CompanionApprovalDialog'

const approval = {
  requestId: 7,
  pairingGeneration: 1,
  deviceName: 'Pixel 8',
  peerIp: '192.168.1.20',
  code: '482913',
  resolved: false,
}

describe('CompanionApprovalDialog', () => {
  it('renders nothing without a pending request', () => {
    const { container } = render(
      <CompanionApprovalDialog approval={null} busy={false} onRespond={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the matching code and answers approve / reject', () => {
    const onRespond = vi.fn()
    render(<CompanionApprovalDialog approval={approval} busy={false} onRespond={onRespond} />)

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('482913')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onRespond).toHaveBeenCalledWith(7, true)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onRespond).toHaveBeenCalledWith(7, false)
  })
})
