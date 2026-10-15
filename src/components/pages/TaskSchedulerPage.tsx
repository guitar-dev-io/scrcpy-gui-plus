import TestSession from '../test-session'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

interface TaskSchedulerPageProps {
  activeDevice: string
  customPath?: string
  outputDir: string
  notify: ToolbarNotifier
}

export default function TaskSchedulerPage({
  activeDevice,
  customPath,
  outputDir,
  notify,
}: TaskSchedulerPageProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="task-scheduler"
          title={t('pages.testSession.title')}
          subtitle={t('pages.testSession.subtitle')}
        />
      </header>

      <section aria-label="Test session" className="mt-5 min-h-0 flex-1">
        <TestSession
          embedded
          isOpen={false}
          onClose={() => {}}
          activeDevice={activeDevice}
          customPath={customPath}
          outputDir={outputDir}
          notify={notify}
        />
      </section>
    </div>
  )
}
