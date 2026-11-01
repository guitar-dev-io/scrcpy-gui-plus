import AppPerformancePanel, { type AppPerformancePanelProps } from '../app-performance'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

export default function AppPerformancePage(props: AppPerformancePanelProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle route="app-performance" title={t('pages.appPerformance.title')} subtitle={t('pages.appPerformance.subtitle')} />
      </header>
      <section aria-label={t('pages.appPerformance.panelAria')} className="mt-5">
        <AppPerformancePanel {...props} />
      </section>
    </div>
  )
}
