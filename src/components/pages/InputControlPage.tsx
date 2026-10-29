import KeymapController from '../keymap-controller'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

interface InputControlPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

export default function InputControlPage({
  activeDevice,
  customPath,
  notify,
}: InputControlPageProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="input-control"
          title={t('pages.inputControl.title')}
          subtitle={t('pages.inputControl.subtitle')}
        />
      </header>

      <section aria-label={t('pages.inputControl.keymapAria')} className="mt-5 min-h-0 flex-1">
        <KeymapController
          embedded
          isOpen={false}
          onClose={() => {}}
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
        />
      </section>
    </div>
  )
}
