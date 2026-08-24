import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import type { RecoveryActionId, RecoveryRecommendation } from '../../types/productTooling'

export function RecoveryDiagnostics({ recommendation, onAction }: {
  recommendation: RecoveryRecommendation | null
  onAction?: (action: RecoveryActionId) => void
}) {
  if (!recommendation) return null
  const Icon = recommendation.severity === 'critical' ? ShieldAlert : recommendation.severity === 'warning' ? AlertTriangle : Info
  return (
    <section aria-label="Recovery recommendation" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex gap-2.5">
        <Icon size={16} className={recommendation.severity === 'critical' ? 'text-red-400' : 'text-amber-400'} />
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-bold text-zinc-100">{recommendation.summary}</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">{recommendation.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {recommendation.actions.map((action) => (
              <button key={action.id} type="button" onClick={() => onAction?.(action.id)} className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-200 hover:border-primary/50">
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
