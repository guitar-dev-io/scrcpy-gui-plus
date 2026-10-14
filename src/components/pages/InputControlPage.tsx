import { Keyboard } from 'lucide-react'
import KeymapController from '../keymap-controller'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'

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
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Keyboard size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">{t('pages.inputControl.title')}</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              {t('pages.inputControl.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Keymap controller" className="mt-5 min-h-0 flex-1">
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
