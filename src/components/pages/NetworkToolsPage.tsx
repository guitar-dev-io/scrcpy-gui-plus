import NetworkToolsPanel, { type NetworkToolsPanelProps } from '../network-tools'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

export default function NetworkToolsPage(props: NetworkToolsPanelProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="network-tools"
          title={t('pages.networkTools.title')}
          subtitle={t('pages.networkTools.subtitle')}
        />
      </header>
      <section aria-label={t('pages.networkTools.panelAria')} className="mt-5">
        <NetworkToolsPanel {...props} />
      </section>
    </div>
  )
}
