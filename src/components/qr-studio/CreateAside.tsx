import type { ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import { QR_TOOLS, type QrToolId } from './destinations'
import { Section, secondaryButtonClass } from './formControls'

interface CreateAsideProps {
  onOpenTool: (tool: QrToolId) => void
  /** Device Actions section, supplied once that destination can render in the aside. */
  deviceActions?: ReactNode
}

export default function CreateAside({ onOpenTool, deviceActions }: CreateAsideProps) {
  return (
    <div className="space-y-3">
      <Section title="Tools" icon={<Wrench size={13} className="text-[#ff4f57]" aria-hidden="true" />}>
        <div className="flex flex-col gap-2">
          {QR_TOOLS.map((tool) => (
            <button key={tool.id} type="button" className={`${secondaryButtonClass} justify-start`} onClick={() => onOpenTool(tool.id)}>
              {tool.label}
            </button>
          ))}
        </div>
      </Section>
      {deviceActions}
    </div>
  )
}
