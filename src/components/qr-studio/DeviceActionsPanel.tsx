import type { ToolbarNotifier } from '../device-control-toolbar'
import { panelClass } from './formControls'
import type { UseQrStore } from './useQrStore'

export interface DeviceActionsPanelProps {
  store: UseQrStore
  devices: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

// PLACEHOLDER: replaced by the real Device Actions in FEAT-006. Remove together with data-testid="qr-placeholder".
export default function DeviceActionsPanel(_props: DeviceActionsPanelProps) {
  return (
    <div className="p-4 lg:p-6">
      <section data-testid="qr-placeholder" aria-labelledby="qr-device-actions-title" className={`${panelClass} p-4`}>
        <h2 id="qr-device-actions-title" className="text-[14px] font-semibold text-white">
          Device Actions
        </h2>
        <p className="mt-2 text-[11px] text-slate-400">Not implemented yet</p>
      </section>
    </div>
  )
}
