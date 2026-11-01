import CrashWatcherPanel, { type CrashWatcherPanelProps } from '../crash-watcher'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

export default function CrashWatcherPage(props: CrashWatcherPanelProps) {
  const { t } = useI18n()
  const watching = Object.values(props.controller.running).filter(Boolean).length
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="crash-watcher"
          title={t('pages.crashWatcher.title')}
          subtitle={t('pages.crashWatcher.subtitle')}
        />
        <span className="text-[var(--font-size-label)] text-[var(--text-subtle)]">
          {t('pages.crashWatcher.watchingCount', { count: watching })}
        </span>
      </header>

      <section aria-label={t('pages.crashWatcher.panelAria')} className="mt-5">
        <CrashWatcherPanel {...props} />
      </section>
    </div>
  )
}
