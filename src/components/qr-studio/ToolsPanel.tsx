import type { ReactNode } from 'react'
import type { QrFieldValues } from '../../types/qrStudio'
import { useConfirm } from '../ui'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { classNames } from '../ui/classNames'
import DecoderTool from './DecoderTool'
import DeepLinkBuilderTool from './DeepLinkBuilderTool'
import QualityTool from './QualityTool'
import WifiTool from './WifiTool'
import { QR_TOOLS, type QrToolId } from './destinations'
import { panelClass } from './formControls'
import type { UseQrDraft } from './useQrDraft'
import type { UseQrStore } from './useQrStore'

export interface ToolsPanelProps {
  store: UseQrStore
  /** The tool opened from the Create aside, or the last one picked. */
  tool: QrToolId
  onSelectTool: (tool: QrToolId) => void
  /** The Create form. Tools load their output into it with "Use in Create". */
  draftApi: UseQrDraft
  /** Switches to the Create destination. */
  onOpenCreate: () => void
  onStatus?: (message: string) => void
  devices?: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice?: string
  customPath?: string
  notify?: ToolbarNotifier
}

const NO_DEVICES: string[] = []
const noopNotify: ToolbarNotifier = () => undefined
const noopStatus = () => undefined

export default function ToolsPanel({
  store,
  tool,
  onSelectTool,
  draftApi,
  onOpenCreate,
  onStatus = noopStatus,
  devices = NO_DEVICES,
  deviceLabels,
  activeDevice = '',
  customPath,
  notify = noopNotify,
}: ToolsPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const active = QR_TOOLS.find((entry) => entry.id === tool) ?? QR_TOOLS[0]

  const useInCreate = async (fields: QrFieldValues) => {
    if (draftApi.dirty) {
      const proceed = await confirm({
        title: 'Replace the Create form?',
        message:
          'The Create form has unsaved changes. Using this code replaces them.',
        confirmLabel: 'Replace',
        tone: 'danger',
      })
      if (!proceed) return
    }
    draftApi.loadFields(fields)
    onOpenCreate()
  }

  const body: Record<QrToolId, ReactNode> = {
    'deep-link-builder': (
      <DeepLinkBuilderTool
        onUseInCreate={(fields) => void useInCreate(fields)}
        onStatus={onStatus}
        devices={devices}
        deviceLabels={deviceLabels}
        activeDevice={activeDevice}
        customPath={customPath}
        notify={notify}
      />
    ),
    wifi: (
      <WifiTool
        store={store}
        onUseInCreate={(fields) => void useInCreate(fields)}
        onStatus={onStatus}
      />
    ),
    decoder: (
      <DecoderTool
        store={store}
        onUseInCreate={(fields) => void useInCreate(fields)}
        onStatus={onStatus}
      />
    ),
    quality: <QualityTool store={store} draftApi={draftApi} />,
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[200px_minmax(0,1fr)] lg:p-6">
      <nav
        aria-label="Tools"
        className={`${panelClass} flex flex-row gap-1 overflow-x-auto p-2 md:flex-col md:self-start`}
      >
        {QR_TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={entry.id === active.id ? 'true' : undefined}
            onClick={() => onSelectTool(entry.id)}
            className={classNames(
              'min-h-9 shrink-0 rounded-lg px-3 text-left text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60',
              entry.id === active.id
                ? 'bg-[#ff4f57]/15 text-[color:var(--qr-text)]'
                : 'text-slate-300 hover:bg-white/5 hover:text-[color:var(--qr-text)]',
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <section
        aria-labelledby="qr-tool-title"
        data-tool={active.id}
        className={`${panelClass} min-w-0 space-y-4 p-4`}
      >
        <h2 id="qr-tool-title" className="text-[14px] font-semibold text-[color:var(--qr-text)]">
          {active.label}
        </h2>
        {body[active.id]}
      </section>
      {confirmDialog}
    </div>
  )
}
