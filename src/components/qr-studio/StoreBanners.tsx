import { secondaryButtonClass } from './formControls'
import type { UseQrStore } from './useQrStore'

/** Persistence errors, load notices and the read-only "Start fresh" action. */
export default function StoreBanners({ store }: { store: UseQrStore }) {
  if (!store.notice && !store.persistError && !store.readOnly) return null
  return (
    <div className="shrink-0 space-y-2 px-4 pt-3 lg:px-6">
      {store.persistError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          {store.persistError}
        </p>
      )}
      {store.notice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
        >
          <span>{store.notice}</span>
          <span className="flex gap-2">
            {store.readOnly && (
              <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={store.startFresh}>
                Start fresh
              </button>
            )}
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={store.dismissNotice}>
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
