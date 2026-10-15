import LogcatViewer from '../logcat-viewer'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

interface LogcatViewerPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  initialTagFilter?: string
}

export default function LogcatViewerPage({
  activeDevice,
  customPath,
  notify,
  initialTagFilter,
}: LogcatViewerPageProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="logcat-viewer"
          title={t('pages.logcat.title')}
          subtitle={t('pages.logcat.subtitle')}
        />
      </header>

      <section aria-label="Logcat stream" className="mt-5 min-h-0 flex-1">
        <LogcatViewer
          embedded
          isOpen={false}
          onClose={() => {}}
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
          initialTagFilter={initialTagFilter}
        />
      </section>
    </div>
  )
}
