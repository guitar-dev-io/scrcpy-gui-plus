import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'

vi.mock('../../hooks/useLogcat', () => ({
  useLogcat: () => ({
    running: true, busy: false, paused: false, minLevel: 'V', search: '', filtered: [], entries: [],
    start: vi.fn(), setMinLevel: vi.fn(), setSearch: vi.fn(), togglePause: vi.fn(), clear: vi.fn(),
  }),
}))

import CompactLogcatPanel from './CompactLogcatPanel'

describe('CompactLogcatPanel Thai locale', () => {
  it('localizes labels, placeholder and empty state', () => {
    render(
      <I18nProvider initialLocale="th">
        <CompactLogcatPanel activeDevice="pixel-1" enabled />
      </I18nProvider>,
    )
    expect(screen.getByRole('textbox', { name: 'กรอง logcat' })).toHaveAttribute(
      'placeholder',
      'กรอง tag, แพ็กเกจ หรือข้อความ…',
    )
    expect(screen.getByRole('button', { name: 'หยุด logcat ชั่วคราว' })).toBeInTheDocument()
    expect(screen.getByText('กำลังรอรายการ logcat ที่ตรงกัน…')).toBeInTheDocument()
  })
})
