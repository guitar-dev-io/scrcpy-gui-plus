import { panelClass } from './formControls'
import type { QrToolId } from './destinations'
import type { UseQrStore } from './useQrStore'

export interface ToolsPanelProps {
  store: UseQrStore
  /** The tool opened from the Create aside, or the last one picked. */
  tool: QrToolId
  onSelectTool: (tool: QrToolId) => void
}

// PLACEHOLDER: replaced by the real Tools in FEAT-006. Remove together with data-testid="qr-placeholder".
export default function ToolsPanel({ tool }: ToolsPanelProps) {
  return (
    <div className="p-4 lg:p-6">
      <section data-testid="qr-placeholder" data-tool={tool} aria-labelledby="qr-tools-title" className={`${panelClass} p-4`}>
        <h2 id="qr-tools-title" className="text-[14px] font-semibold text-white">
          Tools
        </h2>
        <p className="mt-2 text-[11px] text-slate-400">Not implemented yet</p>
      </section>
    </div>
  )
}
