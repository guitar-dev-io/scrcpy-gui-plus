import { Download } from 'lucide-react'
import type { DiagnosticBundle } from '../../types/productTooling'
import { serializeDiagnosticBundle } from '../../services/diagnosticBundleService'

export function DiagnosticBundleReview({ bundle, onExport }: { bundle: DiagnosticBundle; onExport: (content: string, fileName: string) => void | Promise<void> }) {
  const content = serializeDiagnosticBundle(bundle)
  return (
    <section aria-label="Diagnostic bundle review" className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Devices', bundle.summary.deviceCount],
          ['Events', bundle.summary.eventCount],
          ['Errors', bundle.summary.errorCount],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-zinc-800 p-2 text-center"><p className="text-base font-bold text-zinc-100">{value}</p><p className="text-[9px] text-zinc-600">{label}</p></div>)}
      </div>
      <pre className="max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-black/30 p-3 text-[9px] leading-relaxed text-zinc-400">{content}</pre>
      <button type="button" onClick={() => void onExport(content, `mobile-device-studio-diagnostics-${Date.now()}.json`)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-[10px] font-bold text-on-primary"><Download size={13} /> Export reviewed bundle</button>
    </section>
  )
}
