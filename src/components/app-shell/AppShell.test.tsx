import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell'

describe('AppShell', () => {
  it('renders navigation, footer and a tab bar together with the page content', () => {
    render(
      <AppShell
        navigation={<nav aria-label="Primary">Sidebar</nav>}
        footer={<footer>Footer bar</footer>}
        content={
          <>
            <div role="tablist" aria-label="Workspaces">
              Tab bar
            </div>
            <section>Page body</section>
          </>
        }
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByText('Footer bar')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Workspaces' })).toBeInTheDocument()
    expect(screen.getByText('Page body')).toBeInTheDocument()
  })
})
