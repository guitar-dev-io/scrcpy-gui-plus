import type { ReactNode } from 'react'
import ErrorBoundary from '../ErrorBoundary'

interface AppShellProps {
  header?: ReactNode
  navigation?: ReactNode
  content: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export default function AppShell({
  header,
  navigation,
  content,
  footer,
  children,
}: AppShellProps) {
  return (
    <ErrorBoundary>
      <div
        className="flex h-dvh min-h-screen flex-col overflow-hidden font-sans selection:bg-primary selection:text-on-primary"
        style={{
          backgroundColor: 'var(--bg-base)',
          color: 'var(--text-base)',
          opacity: 0,
          animation: 'fadeIn var(--duration-base) ease-out forwards',
        }}
      >
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>

        <a
          href="#app-main-content"
          className="fixed left-4 top-4 z-[500] -translate-y-24 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-[var(--font-size-body-sm)] font-bold text-on-primary shadow-[var(--shadow-lg)] transition-transform duration-[var(--duration-fast)] focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
        >
          Skip to content
        </a>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 bg-[var(--bg-base)]">
            {navigation && (
              <div className="z-[var(--z-sidebar)] min-h-0 shrink-0">
                {navigation}
              </div>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {header && (
                <div className="z-[var(--z-topbar)] shrink-0 bg-[var(--bg-base)] p-3 pb-0">
                  {header}
                </div>
              )}
              <main
                id="app-main-content"
                tabIndex={-1}
                className="custom-scrollbar flex min-w-0 flex-1 flex-col overflow-y-auto focus:outline-none"
              >
                {content}
              </main>
            </div>
          </div>
          {footer && <div className="z-[var(--z-topbar)] shrink-0">{footer}</div>}
        </div>

        <div id="app-overlays">{children}</div>
      </div>
    </ErrorBoundary>
  )
}
