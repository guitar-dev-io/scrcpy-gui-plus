import { useMemo, useState } from 'react'
import { Check, Copy, MousePointerClick } from 'lucide-react'
import type { UiNode } from '../../types/uiInspector'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import type { MaestroBuilderSelector, MaestroCommandId } from '../../types/maestroBuilder'

interface MaestroElementInspectorPanelProps {
  root: UiNode | null
  selected: UiNode | null
  onQuickAction: (commandId: MaestroCommandId, selector: MaestroBuilderSelector) => void
}

const QUICK_ACTIONS: Array<{ id: MaestroCommandId; label: string }> = [
  { id: 'tapOn', label: 'Tap' },
  { id: 'doubleTapOn', label: 'Double Tap' },
  { id: 'longPressOn', label: 'Long Press' },
  { id: 'assertVisible', label: 'Assert Visible' },
  { id: 'inputText', label: 'Input Text' },
  { id: 'scrollUntilVisible', label: 'Wait / Scroll Until' },
]

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      disabled={!value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1000)
        })
      }}
      className="shrink-0 rounded p-1 text-[var(--text-subtle)] hover:bg-white/5 hover:text-primary disabled:opacity-20"
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
    </button>
  )
}

export default function MaestroElementInspectorPanel({ root, selected, onQuickAction }: MaestroElementInspectorPanelProps) {
  const [tab, setTab] = useState<'inspector' | 'actions'>('inspector')
  const recommendations = useMemo(
    () => (root && selected ? recommendMaestroSelectors(root, selected) : []),
    [root, selected],
  )
  const primarySelector = recommendations[0]?.selector
  const selectorText = primarySelector ? `${primarySelector.type}: ${primarySelector.value}` : ''
  const rows = selected
    ? [
        ['Resource ID', selected.resourceId],
        ['Class', selected.className],
        ['Text', selected.text],
        ['Content Desc', selected.contentDesc],
        ['Bounds (px)', `[${selected.bounds.x}, ${selected.bounds.y}] – [${selected.bounds.x + selected.bounds.width}, ${selected.bounds.y + selected.bounds.height}]`],
        ['Size (px)', `${selected.bounds.width} × ${selected.bounds.height}`],
        ['Visible', selected.bounds.width > 0 && selected.bounds.height > 0 ? 'Yes' : 'No'],
        ['Enabled', selected.enabled ? 'Yes' : 'No'],
        ['XPath', selected.xpath],
        ['Selector', selectorText],
      ]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 border-b border-[var(--border-subtle)] px-2">
        {(['inspector', 'actions'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`relative px-3 text-[9px] font-semibold capitalize ${tab === value ? 'text-[var(--text-base)] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-[var(--text-subtle)] hover:text-[var(--text-muted)]'}`}
          >
            {value}
          </button>
        ))}
      </div>

      {!selected ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[var(--text-subtle)]">
          <MousePointerClick size={20} />
          <p className="text-[9px] leading-relaxed">Select an element on Device Preview or in the Hierarchy.</p>
        </div>
      ) : tab === 'inspector' ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-2 rounded border border-primary/25 bg-primary/10 px-2 py-1.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Selected Element</p>
            <p className="mt-1 truncate font-mono text-[9px] text-primary">{selected.resourceId.split('/').pop() || selected.text || selected.className}</p>
          </div>
          <dl className="divide-y divide-[var(--border-subtle)]">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[80px_minmax(0,1fr)_22px] items-start gap-2 py-1.5 text-[8px]">
                <dt className="font-medium text-[var(--text-subtle)]">{label}</dt>
                <dd className={`break-all ${value === 'Yes' ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`}>{value || '—'}</dd>
                {['Resource ID', 'Text', 'XPath', 'Selector'].includes(label) ? <CopyValue label={label} value={value} /> : <span />}
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="mb-2 text-[8px] leading-relaxed text-[var(--text-subtle)]">Add a supported Maestro command using the strongest live selector.</p>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={!primarySelector}
                onClick={() => primarySelector && onQuickAction(action.id, primarySelector)}
                className="h-8 rounded border border-[var(--border-base)] bg-black/10 px-2 text-left text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:bg-primary/10 hover:text-primary disabled:opacity-30"
              >
                {action.label}
              </button>
            ))}
          </div>
          {primarySelector && (
            <div className="mt-3 rounded border border-[var(--border-subtle)] bg-black/10 p-2">
              <p className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Target</p>
              <p className="mt-1 break-all font-mono text-[8px] text-[var(--text-muted)]">{selectorText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
