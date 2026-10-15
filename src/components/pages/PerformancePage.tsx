import { Gauge } from 'lucide-react'
import ConnectionHealth from '../connection-health'
import { useI18n } from '../../i18n'

interface PerformancePageProps {
  /** Render only the health panel, for the Dashboard activity drawer. */
  embedded?: boolean
  connected: boolean
  bitrateMbps?: number
  adaptiveEnabled?: boolean
  onApplySaferProfile?: (profile: 'balanced' | 'low-latency') => void
}

export default function PerformancePage({ embedded = false, connected, bitrateMbps, adaptiveEnabled, onApplySaferProfile }: PerformancePageProps) {
  const { t } = useI18n()
  const health = (
    <ConnectionHealth
      embedded
      isOpen={false}
      onClose={() => {}}
      connected={connected}
      bitrateMbps={bitrateMbps}
      adaptiveEnabled={adaptiveEnabled}
      onApplySaferProfile={onApplySaferProfile}
    />
  )
  if (embedded) return health

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Gauge size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">{t('pages.performance.title')}</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              {t('pages.performance.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Connection health" className="mt-5 min-h-0 flex-1">
        {health}
      </section>
    </div>
  )
}
