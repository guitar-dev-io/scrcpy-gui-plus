import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Info, Keyboard, SlidersHorizontal, Wrench, type LucideIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

type SettingsSectionId = 'general' | 'advanced' | 'shortcuts' | 'about'

export interface SettingsPageProps {
  general: ReactNode
  advanced: ReactNode
  shortcuts: ReactNode
  about: ReactNode
  /** Section to scroll to when the page opens. */
  initialSection?: SettingsSectionId
}

const SETTINGS_SECTIONS: { id: SettingsSectionId; icon: LucideIcon }[] = [
  { id: 'general', icon: SlidersHorizontal },
  { id: 'advanced', icon: Wrench },
  { id: 'shortcuts', icon: Keyboard },
  { id: 'about', icon: Info },
]

/**
 * All settings on one scrolling page, with a sticky table of contents. Most
 * sections are short, so tabs only hid them; one page keeps everything
 * visible and searchable, and the contents list still jumps to a section and
 * tracks which one is in view.
 */
export default function SettingsPage({
  general,
  advanced,
  shortcuts,
  about,
  initialSection,
}: SettingsPageProps) {
  const { t } = useI18n()
  const idPrefix = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLElement | null>>>({})
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection ?? 'general')

  const content: Record<SettingsSectionId, ReactNode> = {
    general,
    advanced,
    shortcuts,
    about,
  }

  const scrollToSection = (id: SettingsSectionId, behavior: ScrollBehavior = 'smooth') => {
    setActiveSection(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior, block: 'start' })
  }

  useEffect(() => {
    if (initialSection) scrollToSection(initialSection, 'auto')
    // Only on mount: later prop changes must not yank the user's scroll.
  }, [])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    // A section counts as current once its heading crosses the top third of
    // the scroll area.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const id = visible?.target.getAttribute('data-section') as SettingsSectionId | null
        if (id) setActiveSection(id)
      },
      { root, rootMargin: '0px 0px -66% 0px' },
    )
    Object.values(sectionRefs.current).forEach((element) => {
      if (element) observer.observe(element)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="settings"
          title={t('pages.settings.title')}
          subtitle={t('pages.settings.subtitle')}
        />
      </header>

      <div className="mt-5 flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] max-md:flex-col">
        <nav
          aria-label={t('settings.sections')}
          className="flex w-56 shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] p-3 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-b max-md:border-r-0"
        >
          {SETTINGS_SECTIONS.map(({ id, icon: Icon }) => {
            const current = activeSection === id
            return (
              <a
                key={id}
                href={`#${idPrefix}-${id}`}
                aria-current={current ? 'true' : undefined}
                onClick={(event) => {
                  // The app routes on the URL hash, so scroll in place
                  // instead of letting the anchor change it.
                  event.preventDefault()
                  scrollToSection(id)
                }}
                className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-md:shrink-0 ${
                  current
                    ? 'bg-primary/15 text-[var(--text-base)] shadow-[inset_2px_0_0_rgb(var(--primary-rgb))]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'
                }`}
              >
                <Icon size={15} className={`mt-0.5 shrink-0 ${current ? 'text-primary' : ''}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium">{t(`settings.tabs.${id}`)}</span>
                  <span className="mt-0.5 block text-[9px] leading-snug text-[var(--text-subtle)] max-md:hidden">
                    {t(`settings.tabDescriptions.${id}`)}
                  </span>
                </span>
              </a>
            )
          })}
        </nav>

        <div ref={scrollRef} className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto scroll-smooth">
          {SETTINGS_SECTIONS.map(({ id }, index) => (
            <section
              key={id}
              id={`${idPrefix}-${id}`}
              data-section={id}
              ref={(element) => {
                sectionRefs.current[id] = element
              }}
              aria-labelledby={`${idPrefix}-${id}-heading`}
              className={`scroll-mt-0 p-4 sm:p-5 lg:p-6 ${index > 0 ? 'border-t border-[var(--border-subtle)]' : ''}`}
            >
              <div className="w-full max-w-3xl">
                <h2 id={`${idPrefix}-${id}-heading`} className="text-sm font-semibold text-[var(--text-base)]">
                  {t(`settings.tabs.${id}`)}
                </h2>
                <p className="mb-4 mt-0.5 text-[10px] text-[var(--text-subtle)]">
                  {t(`settings.tabDescriptions.${id}`)}
                </p>
                {content[id]}
              </div>
            </section>
          ))}
          {/* Lets the last section scroll up to the top so its entry can
              become current. */}
          <div aria-hidden="true" className="h-[40vh]" />
        </div>
      </div>
    </div>
  )
}
