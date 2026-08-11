import { useRef, useState } from 'react'
import { Check, Copy, Upload } from 'lucide-react'

interface MaestroYamlPreviewPanelProps {
  yaml: string
  onImport: (yaml: string) => void
}

export default function MaestroYamlPreviewPanel({ yaml, onImport }: MaestroYamlPreviewPanelProps) {
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const copy = () => {
    navigator.clipboard
      .writeText(yaml)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => undefined)
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return
    file.text().then(onImport).catch(() => undefined)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">YAML Preview</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Import YAML"
          className="ml-auto flex h-6 items-center gap-1 rounded-md border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
        >
          <Upload size={10} /> Import
        </button>
        <button
          type="button"
          onClick={copy}
          title="Copy YAML"
          className="flex h-6 items-center gap-1 rounded-md border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[8px] leading-relaxed text-[var(--text-muted)]">
        {yaml}
      </pre>
    </div>
  )
}
