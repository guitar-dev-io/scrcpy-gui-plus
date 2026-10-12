import type { ReactNode } from 'react'
import { ArrowRight, Wrench } from 'lucide-react'
import { QR_TOOLS, type QrDestination, type QrToolId } from './destinations'
import { Section, secondaryButtonClass } from './formControls'

interface CreateAsideProps {
  onOpenTool: (tool: QrToolId) => void
  /** Jumps to a full destination (Device Actions or Tools). */
  onOpenDestination?: (destination: QrDestination) => void
  /** Device Actions section, supplied once that destination can render in the aside. */
  deviceActions?: ReactNode
}

/** Right column of Create: Device Actions and Tools shortcut cards. */
export default function CreateAside({ onOpenTool, onOpenDestination, deviceActions }: CreateAsideProps) {
  return (
    <div className="min-w-0 space-y-3">
      {deviceActions}
      {onOpenDestination && (
        <button
          type="button"
          className={`${secondaryButtonClass} w-full justify-between`}
          onClick={() => onOpenDestination('device-actions')}
        >
          Open Device Actions
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      )}
      <Section title="Tools" icon={<Wrench size={13} className="text-[color:var(--qr-coral)]" aria-hidden="true" />}>
        <div className="flex flex-col gap-2">
          {QR_TOOLS.map((tool) => (
            <button key={tool.id} type="button" className={`${secondaryButtonClass} justify-start`} onClick={() => onOpenTool(tool.id)}>
              {tool.label}
            </button>
          ))}
          {onOpenDestination && (
            <button
              type="button"
              className={`${secondaryButtonClass} justify-between`}
              onClick={() => onOpenDestination('tools')}
            >
              Open Tools
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </Section>
    </div>
  )
}
