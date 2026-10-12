import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg, launchDeepLink } from '../../services/deepLinkService'
import { sendQrToDevice } from '../../services/qrDeviceService'
import { QR_STUDIO_V2_STORAGE_KEY, clearQrSvgCache } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE, type QrRecord } from '../../types/qrStudio'
import { mockLayout } from '../ui/overlay/testUtils'
import LibraryPanel from './LibraryPanel'
import { CONNECT_TEXT } from './useDeviceActions'
import { useQrStore, type UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn(), launchDeepLink: vi.fn() }))
vi.mock('../../services/qrDeviceService', () => ({ sendQrToDevice: vi.fn() }))
vi.mock('./qrDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qrDownloads')>()),
  renderPngBase64: vi.fn(async () => 'AAAA'),
}))

const launchMock = vi.mocked(launchDeepLink)
const sendMock = vi.mocked(sendQrToDevice)
const iso = '2026-01-01T00:00:00.000Z'

function rec(i: number, over: Partial<QrRecord> = {}): QrRecord {
  return {
    id: `r${i}`,
    name: `Code ${i}`,
    content: `https://example.com/${i}`,
    contentType: 'url',
    style: { ...DEFAULT_QR_STYLE },
    createdAt: iso,
    updatedAt: iso,
    folderId: null,
    tags: [],
    notes: '',
    trashedAt: null,
    source: 'created',
    ...over,
  }
}

function seed(records: QrRecord[]) {
  window.localStorage.setItem(
    QR_STUDIO_V2_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 2, records, folders: [], tags: [], templates: [] }),
  )
}

let store: UseQrStore
const notify = vi.fn()

function Harness({ connected = true }: { connected?: boolean }) {
  const s = useQrStore()
  store = s
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  return (
    <LibraryPanel
      store={s}
      selection={selection}
      onSelectionChange={setSelection}
      onEditRecord={vi.fn()}
      containerWidth={1400}
      devices={connected ? ['SER'] : []}
      deviceLabels={{ SER: 'Pixel 7' }}
      activeDevice={connected ? 'SER' : ''}
      customPath="/opt/adb"
      notify={notify}
    />
  )
}

const card = (name: string) => screen.getByRole('article', { name })
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(card(name)).getByRole('button', { name: `Actions for ${name}` }))

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearQrSvgCache()
  launchMock.mockReset()
  launchMock.mockResolvedValue({ success: true })
  sendMock.mockReset()
  notify.mockReset()
  vi.mocked(generateQrSvg).mockReset()
  vi.mocked(generateQrSvg).mockResolvedValue('<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Library device actions', () => {
  it('opens a record created in Create straight from the card menu', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)])
      render(<Harness />)
      await openMenu(user, 'Code 1')
      await user.click(screen.getByRole('menuitem', { name: 'Open on device' }))
      await waitFor(() => expect(launchMock).toHaveBeenCalledWith('SER', 'https://example.com/1', undefined, '/opt/adb'))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await waitFor(() => expect(store.state.records[0].lastUsedAt).toBeTruthy())
    } finally {
      restore()
    }
  })

  it('confirms an imported record first with Cancel focused, from the menu and from the details', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1, { source: 'imported', content: 'https://example.com/?a=1&b=2' })])
      render(<Harness />)
      await openMenu(user, 'Code 1')
      await user.click(screen.getByRole('menuitem', { name: 'Open on device' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByTestId('launch-uri').textContent).toBe('https://example.com/?a=1&b=2')
      await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(launchMock).not.toHaveBeenCalled()

      await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
      const details = screen.getByRole('complementary', { name: 'Details' })
      await user.click(within(details).getByRole('button', { name: 'Open on device' }))
      const again = await screen.findByRole('alertdialog')
      await user.click(within(again).getByRole('button', { name: 'Open on device' }))
      await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1))
      expect(launchMock).toHaveBeenCalledWith('SER', 'https://example.com/?a=1&b=2', undefined, '/opt/adb')
      expect(await within(details).findByText('Opened on Pixel 7')).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('sends a record to the device from the menu and reports where it was saved', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)])
      sendMock.mockResolvedValue({ success: true, scan: true, pathOnDevice: '/sdcard/Download/code-1-aa.png' })
      render(<Harness />)
      await openMenu(user, 'Code 1')
      await user.click(screen.getByRole('menuitem', { name: 'Send to device' }))
      await waitFor(() => expect(sendMock).toHaveBeenCalledWith('SER', 'code-1.png', 'AAAA', '/opt/adb'))
      await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
      const details = screen.getByRole('complementary', { name: 'Details' })
      expect(await within(details).findByText(/Saved to Downloads\/code-1-aa\.png on Pixel 7/)).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('disables the device actions with visible text and never invokes anything without a device', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)])
      render(<Harness connected={false} />)
      await openMenu(user, 'Code 1')
      expect(screen.getByRole('menuitem', { name: 'Open on device' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('menuitem', { name: 'Send to device' })).toHaveAttribute('aria-disabled', 'true')
      await user.keyboard('{Escape}')

      await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
      const details = screen.getByRole('complementary', { name: 'Details' })
      for (const name of ['Open on device', 'Send to device']) {
        const button = within(details).getByRole('button', { name })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
      }
      expect(within(details).getAllByText(CONNECT_TEXT)).toHaveLength(2)
      expect(launchMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('explains a non-launchable record in the details', async () => {
    const user = userEvent.setup()
    seed([rec(1, { contentType: 'text', content: 'just words' })])
    render(<Harness />)
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
    const details = screen.getByRole('complementary', { name: 'Details' })
    expect(within(details).getByRole('button', { name: 'Open on device' })).toBeDisabled()
    expect(within(details).getByText('This type is not a launchable link')).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Send to device' })).toBeEnabled()
  })
})
