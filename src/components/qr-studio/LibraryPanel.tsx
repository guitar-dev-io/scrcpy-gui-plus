import type { QrRecord } from '../../types/qrStudio'
import { panelClass } from './formControls'
import type { UseQrStore } from './useQrStore'

export interface LibraryPanelProps {
  store: UseQrStore
  /** Selected record ids, owned by the container so Templates can restyle the selection. */
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
  /** Opens a record in the Create destination. */
  onEditRecord: (record: QrRecord) => void
}

// PLACEHOLDER: replaced by the real Library in FEAT-005. Remove together with data-testid="qr-placeholder".
export default function LibraryPanel(_props: LibraryPanelProps) {
  return (
    <div className="p-4 lg:p-6">
      <section data-testid="qr-placeholder" aria-labelledby="qr-library-title" className={`${panelClass} p-4`}>
        <h2 id="qr-library-title" className="text-[14px] font-semibold text-white">
          Library
        </h2>
        <p className="mt-2 text-[11px] text-slate-400">Not implemented yet</p>
      </section>
    </div>
  )
}
