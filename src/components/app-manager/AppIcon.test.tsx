import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPackageIcon = vi.hoisted(() => vi.fn())
vi.mock('../../services/apkToolkitService', () => ({ getPackageIcon }))

import { clearPackageIconCache } from '../../hooks/usePackageIcon'
import { AppIcon } from './AppIcon'

describe('AppIcon', () => {
  beforeEach(() => { clearPackageIconCache(); getPackageIcon.mockReset() })

  it('deduplicates lazy icon requests and replaces the glyph fallback', async () => {
    getPackageIcon.mockResolvedValue({ success: true, packageName: 'com.example', dataUrl: 'data:image/png;base64,AAAA' })
    const { container } = render(<><AppIcon eager serial="pixel" packageName="com.example" /><AppIcon eager serial="pixel" packageName="com.example" /></>)
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2))
    expect(getPackageIcon).toHaveBeenCalledOnce()
  })

  it('keeps the deterministic glyph when icon extraction fails', async () => {
    getPackageIcon.mockResolvedValue({ success: false, packageName: 'com.example' })
    const { container } = render(<AppIcon eager serial="pixel" packageName="com.example" />)
    await waitFor(() => expect(getPackageIcon).toHaveBeenCalledOnce())
    expect(container).toHaveTextContent('E')
  })

  it('does not pull an APK icon until the row is selected', () => {
    const { container } = render(<AppIcon serial="pixel" packageName="com.example" />)
    expect(getPackageIcon).not.toHaveBeenCalled()
    expect(container).toHaveTextContent('E')
  })

  it('bounds global icon extraction concurrency to three requests', async () => {
    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    getPackageIcon.mockImplementation((_serial, packageName) => new Promise((resolve) => {
      active += 1
      maximum = Math.max(maximum, active)
      releases.push(() => { active -= 1; resolve({ success: true, packageName, dataUrl: 'data:image/png;base64,AAAA' }) })
    }))
    render(<>{Array.from({ length: 6 }, (_, index) => <AppIcon key={index} eager serial="pixel" packageName={`com.example.${index}`} />)}</>)
    await waitFor(() => expect(getPackageIcon).toHaveBeenCalledTimes(3))
    releases.splice(0, 3).forEach((release) => release())
    await waitFor(() => expect(getPackageIcon).toHaveBeenCalledTimes(6))
    releases.forEach((release) => release())
    expect(maximum).toBe(3)
  })
})
