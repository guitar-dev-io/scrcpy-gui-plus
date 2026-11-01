import DeviceConditionsPanel from '../device-conditions'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

interface DeviceConditionsPageProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  selectedDeviceIds?: readonly string[]
  confirmAction?: (title: string, message: string, onConfirm: () => void) => void
}

export default function DeviceConditionsPage({
  activeDevice,
  customPath,
  notify,
  selectedDeviceIds,
  confirmAction,
}: DeviceConditionsPageProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="device-conditions"
          title={t('pages.deviceConditions.title')}
          subtitle={t('pages.deviceConditions.subtitle')}
        />
      </header>

      <section aria-label={t('pages.deviceConditions.panelAria')} className="mt-5">
        <DeviceConditionsPanel
          activeDevice={activeDevice}
          customPath={customPath}
          notify={notify}
          selectedDeviceIds={selectedDeviceIds}
          confirmAction={confirmAction}
        />
      </section>
    </div>
  )
}
