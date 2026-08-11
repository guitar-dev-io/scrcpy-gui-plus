import { ExternalLink, Loader2 } from 'lucide-react'
import type { MaestroAvailability } from '../../types/maestro'

export const MAESTRO_INSTALLATION_HELP_URL =
  'https://docs.maestro.dev/getting-started/installing-maestro'

export interface MaestroCliStatusBannerProps {
  checking: boolean
  availability: MaestroAvailability | null | undefined
  onRetry: () => void
}

/**
 * Standalone CLI availability status for Maestro surfaces.
 *
 * The checking state takes precedence while an availability probe is running;
 * a missing availability result is treated as unavailable so the component is
 * safe to render before the first probe completes.
 */
export default function MaestroCliStatusBanner({
  checking,
  availability,
  onRetry,
}: MaestroCliStatusBannerProps) {
  const className = checking
    ? 'border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-subtle)]'
    : availability?.found
      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
      : 'border-red-500/40 bg-red-500/10 text-red-300'

  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[9px] ${className}`}
      role={checking || availability?.found ? 'status' : 'alert'}
      aria-live={checking || availability?.found ? 'polite' : 'assertive'}
    >
      {checking ? (
        <>
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          <span>Checking Maestro CLI…</span>
        </>
      ) : availability?.found ? (
        <span>
          Maestro CLI found
          {availability.version ? ` · ${availability.version}` : ''}
        </span>
      ) : (
        <>
          <strong>Maestro CLI unavailable</strong>
          <span className="min-w-0 flex-1 truncate">
            {availability?.error || 'Maestro was not found on PATH.'}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-red-400/30 px-2 py-1 font-semibold"
          >
            Retry
          </button>
          <a
            href={MAESTRO_INSTALLATION_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-semibold underline"
          >
            Installation Help <ExternalLink size={10} aria-hidden="true" />
          </a>
        </>
      )}
    </div>
  )
}
