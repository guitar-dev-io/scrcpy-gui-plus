import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Settings } from 'lucide-react'

type SettingsTabId = 'general' | 'advanced' | 'shortcuts' | 'about'

export interface SettingsPageProps {
  general: ReactNode
  advanced: ReactNode
  shortcuts: ReactNode
  about: ReactNode
  initialTab?: SettingsTabId
}

interface SettingsTab {
  id: SettingsTabId
  label: string
}

const SETTINGS_TABS: SettingsTab[] = [
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' },
]

export default function SettingsPage({
  general,
  advanced,
  shortcuts,
  about,
  initialTab = 'general',
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab)
  const tabListId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const content: Record<SettingsTabId, ReactNode> = {
    general,
    advanced,
    shortcuts,
    about,
  }

  const selectTab = (index: number) => {
    const tab = SETTINGS_TABS[index]
    if (!tab) return

    setActiveTab(tab.id)
    tabRefs.current[index]?.focus()
  }

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % SETTINGS_TABS.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = SETTINGS_TABS.length - 1
    }

    if (nextIndex === undefined) return

    event.preventDefault()
    selectTab(nextIndex)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Settings size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">Settings</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              Configure application preferences and existing device controls.
            </p>
          </div>
        </div>
      </header>

      <section className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
        <div className="custom-scrollbar shrink-0 overflow-x-auto border-b border-[var(--border-subtle)] px-3 sm:px-5">
          <div
            id={tabListId}
            role="tablist"
            aria-label="Settings sections"
            className="flex min-w-max gap-1"
          >
            {SETTINGS_TABS.map((tab, index) => {
              const selected = activeTab === tab.id

              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[index] = element
                  }}
                  id={`${tabListId}-${tab.id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${tabListId}-${tab.id}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={`relative h-11 min-w-20 px-3 text-[10px] font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
                    selected
                      ? 'text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                      : 'text-[var(--text-subtle)] hover:text-[var(--text-base)]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {SETTINGS_TABS.map((tab) => {
          const selected = activeTab === tab.id

          return (
            <div
              key={tab.id}
              id={`${tabListId}-${tab.id}-panel`}
              role="tabpanel"
              aria-labelledby={`${tabListId}-${tab.id}-tab`}
              tabIndex={0}
              hidden={!selected}
              className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] sm:p-5 lg:p-6"
            >
              <div className="mx-auto w-full max-w-3xl">{content[tab.id]}</div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
