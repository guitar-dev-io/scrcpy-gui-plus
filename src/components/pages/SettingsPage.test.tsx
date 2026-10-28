import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'

const scrollIntoView = vi.fn()

function renderPage(props: Partial<ComponentProps<typeof SettingsPage>> = {}) {
  return render(
    <SettingsPage
      general={<div>general body</div>}
      advanced={<div>advanced body</div>}
      shortcuts={<div>shortcuts body</div>}
      about={<div>about body</div>}
      {...props}
    />,
  )
}

function navLink(name: string) {
  return screen.getByRole('link', { name: new RegExp(`^${name}`) })
}

beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})

describe('SettingsPage', () => {
  it('renders every section body on one page', () => {
    renderPage()

    for (const body of ['general body', 'advanced body', 'shortcuts body', 'about body']) {
      expect(screen.getByText(body)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'General',
      'Advanced',
      'Shortcuts',
      'About',
    ])
  })

  it('marks General current by default', () => {
    renderPage()

    expect(navLink('General')).toHaveAttribute('aria-current', 'true')
    expect(navLink('Advanced')).not.toHaveAttribute('aria-current')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls to a section in place without changing the URL hash', () => {
    window.location.hash = '#/settings'
    renderPage()

    fireEvent.click(navLink('Shortcuts'))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(navLink('Shortcuts')).toHaveAttribute('aria-current', 'true')
    expect(navLink('General')).not.toHaveAttribute('aria-current')
    expect(window.location.hash).toBe('#/settings')
  })

  it('opens on the requested section and scrolls to it once', () => {
    renderPage({ initialSection: 'about' })

    expect(navLink('About')).toHaveAttribute('aria-current', 'true')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('does not scroll again when the initial section prop changes later', () => {
    const view = renderPage({ initialSection: 'about' })
    scrollIntoView.mockClear()

    view.rerender(
      <SettingsPage
        general={<div>general body</div>}
        advanced={<div>advanced body</div>}
        shortcuts={<div>shortcuts body</div>}
        about={<div>about body</div>}
        initialSection="advanced"
      />,
    )

    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(navLink('About')).toHaveAttribute('aria-current', 'true')
  })
})
