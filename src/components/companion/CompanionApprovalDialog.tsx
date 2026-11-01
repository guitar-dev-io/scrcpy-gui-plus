import { ShieldCheck } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { CompanionApprovalEvent } from '../../types/companion'

interface CompanionApprovalDialogProps {
  approval: CompanionApprovalEvent | null
  busy: boolean
  onRespond: (requestId: number, approve: boolean) => void
}

/**
 * A phone that found this desktop with "Find on this network" waits on the
 * desktop user's yes/no. That can arrive on any page, so the prompt lives at
 * the app root instead of inside one pairing screen.
 */
export default function CompanionApprovalDialog({
  approval,
  busy,
  onRespond,
}: CompanionApprovalDialogProps) {
  const { t } = useI18n()
  if (!approval) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="companion-approval-title"
      className="fixed inset-0 z-[310] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm space-y-3 rounded-2xl border border-amber-500/40 bg-zinc-950/95 p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-amber-400" />
          <h3
            id="companion-approval-title"
            className="text-[12px] font-black uppercase tracking-widest text-amber-300"
          >
            {t('pairDevice.approvalTitle')}
          </h3>
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-300">
          {t('pairDevice.approvalBody', {
            device: approval.deviceName,
            ip: approval.peerIp,
          })}
        </p>
        <p className="text-center font-mono text-3xl font-bold tracking-[0.3em] text-amber-300">
          {approval.code}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => onRespond(approval.requestId, true)}
            className="flex-1 rounded-xl bg-primary py-2.5 text-[11px] font-black uppercase tracking-widest text-on-primary hover:brightness-110 disabled:opacity-40"
          >
            {t('pairDevice.approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRespond(approval.requestId, false)}
            className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:border-red-500/50 hover:text-red-400 disabled:opacity-40"
          >
            {t('pairDevice.reject')}
          </button>
        </div>
      </div>
    </div>
  )
}
