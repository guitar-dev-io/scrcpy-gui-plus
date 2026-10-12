import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import type { QrQualityReport } from '../../services/qrQuality'
import { Section } from './formControls'

export type VerifyState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'verified' }
  | { status: 'mismatch'; decoded: string }
  | { status: 'undecodable'; message?: string }

interface QualityPanelProps {
  report: QrQualityReport
  /** Contrast ratio of the chosen colors, or null when a color is invalid. */
  contrast: number | null
  verify: VerifyState
}

export default function QualityPanel({ report, contrast, verify }: QualityPanelProps) {
  return (
    <Section title="Scan quality" icon={<ShieldCheck size={13} className="text-[#ff4f57]" aria-hidden="true" />}>
      {contrast !== null && (
        <p className="mb-2 text-[11px] text-slate-400">
          <b className="text-slate-200">{contrast.toFixed(1)}:1</b> contrast
        </p>
      )}
      <ul aria-label="Quality checks" className="space-y-1.5">
        {report.issues.length === 0 && (
          <li className="flex items-start gap-2 text-[11px] text-emerald-300">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            Colors, size and content look scan friendly.
          </li>
        )}
        {report.issues.map((issue) => (
          <li
            key={issue.code}
            data-level={issue.level}
            className={`flex items-start gap-2 text-[11px] ${issue.level === 'error' ? 'text-red-300' : 'text-amber-300'}`}
          >
            {issue.level === 'error' ? (
              <XCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              <span className="sr-only">{issue.level === 'error' ? 'Error: ' : 'Warning: '}</span>
              {issue.message}
            </span>
          </li>
        ))}
      </ul>
      <div role="status" className="mt-2 min-h-4 text-[11px]">
        {verify.status === 'running' && (
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Verifying scan…
          </span>
        )}
        {verify.status === 'verified' && <span className="text-emerald-300">Verified: the scan matches the content.</span>}
        {verify.status === 'mismatch' && <span className="text-red-300">Mismatch: the scan returned different content.</span>}
        {verify.status === 'undecodable' && (
          <span className="text-amber-300">Could not decode{verify.message ? `: ${verify.message}` : ' this code.'}</span>
        )}
      </div>
    </Section>
  )
}
