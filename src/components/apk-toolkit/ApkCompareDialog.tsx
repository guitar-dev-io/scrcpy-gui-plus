import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowRight, FileArchive, Loader2, Search, ShieldCheck, ShieldQuestion, ShieldX, X } from 'lucide-react'
import { analyzeApkFile } from '../../services/apkToolkitService'
import { compareApkAnalyses } from '../../services/apkCompareService'
import type { ApkCompareCategory, ApkCompareInput, ApkCompareResult } from '../../types/apkCompare'
import type { ApkAnalysisResult } from '../../types/apkToolkit'
import { formatPackageBytes } from '../../utils/appManagerView'

export interface ApkCompareDialogProps {
  open: boolean
  left?: ApkCompareInput
  right?: ApkCompareInput
  onClose: () => void
}

const originLabel = (input?: ApkCompareInput) => input?.label
  ?? (input?.origin === 'installed_extraction' ? 'Installed app extraction' : input?.origin === 'extracted' ? 'Extracted APK' : 'Local APK')

export function ApkCompareDialog({ open: isOpen, left, right, onClose }: ApkCompareDialogProps) {
  const [leftInput, setLeftInput] = useState<ApkCompareInput | undefined>(left)
  const [rightInput, setRightInput] = useState<ApkCompareInput | undefined>(right)
  const [analyses, setAnalyses] = useState<[ApkAnalysisResult, ApkAnalysisResult]>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const runCompare = async (before = leftInput, after = rightInput) => {
    if (!before?.path || !after?.path) return
    setLoading(true); setError(''); setAnalyses(undefined)
    try {
      const next = await Promise.all([analyzeApkFile(before.path), analyzeApkFile(after.path)])
      const failed = next.find((analysis) => !analysis.success || analysis.error)
      if (failed) throw new Error(failed.error || 'APK analysis failed')
      setAnalyses(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) { setAnalyses(undefined); setError(''); setLoading(false); return }
    setLeftInput(left); setRightInput(right)
    if (left?.path && right?.path) void runCompare(left, right)
    // Inputs intentionally trigger a fresh immutable comparison when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, left?.path, right?.path])

  if (!isOpen) return null
  const choose = async (side: 'left' | 'right') => {
    const selected = await open({ multiple: false, filters: [{ name: 'Android packages', extensions: ['apk'] }], title: side === 'left' ? 'Choose reference APK' : 'Choose comparison APK' })
    if (typeof selected !== 'string') return
    const input: ApkCompareInput = { path: selected, origin: 'local' }
    if (side === 'left') setLeftInput(input); else setRightInput(input)
    setAnalyses(undefined); setError('')
  }
  const result = analyses ? compareApkAnalyses(analyses[0], analyses[1]) : undefined
  return <div className="fixed inset-0 z-[390] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="APK Compare" onClick={(event) => event.stopPropagation()} className="flex h-[min(820px,88vh)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div><h2 className="text-[12px] font-semibold text-[var(--text-base)]">APK Compare</h2><p className="text-[9px] text-[var(--text-subtle)]">Structured manifest, native, signing, and size comparison</p></div><button type="button" aria-label="Close APK Compare" onClick={onClose} className="p-2 text-[var(--text-subtle)]"><X size={15} /></button></header>
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[var(--border-subtle)] p-4">
        <FilePicker side="Reference" input={leftInput} onChoose={() => void choose('left')} />
        <ArrowRight size={16} className="text-[var(--text-subtle)]" />
        <FilePicker side="Comparison" input={rightInput} onChoose={() => void choose('right')} />
        <button type="button" disabled={!leftInput?.path || !rightInput?.path || loading} onClick={() => void runCompare()} className="col-span-3 mx-auto h-8 rounded-md bg-primary px-5 text-[9px] font-semibold text-on-primary disabled:opacity-40">Compare APKs</button>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
        {loading ? <div aria-label="Comparing APKs" className="flex h-full items-center justify-center gap-2 text-[10px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" />Analyzing both APKs…</div>
          : error ? <p className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-[10px] text-red-400">{error}</p>
            : result ? <ApkCompareResults result={result} leftLabel={originLabel(leftInput)} rightLabel={originLabel(rightInput)} />
              : <div className="flex h-full flex-col items-center justify-center text-[var(--text-subtle)]"><FileArchive size={28} /><p className="mt-2 text-[9px]">Choose two APK files. An extracted installed-app base APK can be used as either side.</p></div>}
      </div>
    </section>
  </div>
}

function FilePicker({ side, input, onChoose }: { side: string; input?: ApkCompareInput; onChoose: () => void }) {
  return <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[8px] font-bold uppercase tracking-wide text-primary">{side} · {originLabel(input)}</span><button type="button" aria-label={`Choose ${side.toLowerCase()} APK`} onClick={onChoose} className="rounded p-1 text-[var(--text-subtle)] hover:text-primary"><Search size={12} /></button></div><p className="mt-1 truncate font-mono text-[8px] text-[var(--text-muted)]" title={input?.path}>{input?.path || 'No APK selected'}</p></div>
}

export function ApkCompareResults({ result, leftLabel = 'Reference', rightLabel = 'Comparison' }: { result: ApkCompareResult; leftLabel?: string; rightLabel?: string }) {
  const [activeId, setActiveId] = useState<ApkCompareCategory['id']>('identity')
  const active = result.categories.find((entry) => entry.id === activeId) ?? result.categories[0]
  const grouped = useMemo(() => ({
    added: active.changes.filter((change) => change.kind === 'added'),
    removed: active.changes.filter((change) => change.kind === 'removed'),
    changed: active.changes.filter((change) => change.kind === 'changed'),
    same: active.changes.filter((change) => change.kind === 'same'),
  }), [active])
  const signer = result.signerRelation === 'same'
    ? { Icon: ShieldCheck, text: 'Same signer', tone: 'text-emerald-300 bg-emerald-500/10' }
    : result.signerRelation === 'different'
      ? { Icon: ShieldX, text: 'Different signer', tone: 'text-red-300 bg-red-500/10' }
      : { Icon: ShieldQuestion, text: 'Signer unknown', tone: 'text-amber-300 bg-amber-500/10' }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><span className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[9px] font-semibold ${signer.tone}`}><signer.Icon size={12} />{signer.text}</span><span className={`rounded-md px-2 py-1 text-[9px] ${result.packageMatch === false ? 'bg-red-500/10 text-red-300' : 'bg-white/5 text-[var(--text-muted)]'}`}>{result.packageMatch === null ? 'Package unknown' : result.packageMatch ? 'Same package' : 'Different package'}</span><span className="ml-auto text-[8px] text-[var(--text-subtle)]">+{result.summary.added} added · −{result.summary.removed} removed · {result.summary.changed} changed</span></div>
    <nav role="tablist" aria-label="APK compare categories" className="custom-scrollbar flex overflow-x-auto border-b border-[var(--border-subtle)]">{result.categories.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={entry.id === active.id} onClick={() => setActiveId(entry.id)} className={`h-9 shrink-0 border-b-2 px-3 text-[9px] ${entry.id === active.id ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)]'}`}>{entry.label}{entry.status === 'changed' ? ` (${entry.added + entry.removed + entry.changed})` : ''}</button>)}</nav>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3"><ChangeSection title="Added" tone="text-emerald-300" changes={grouped.added} leftLabel={leftLabel} rightLabel={rightLabel} /><ChangeSection title="Removed" tone="text-red-300" changes={grouped.removed} leftLabel={leftLabel} rightLabel={rightLabel} /><ChangeSection title="Changed" tone="text-amber-300" changes={grouped.changed} leftLabel={leftLabel} rightLabel={rightLabel} /></div>
    {grouped.added.length + grouped.removed.length + grouped.changed.length === 0 && <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 py-8 text-center text-[9px] text-emerald-300">No differences in {active.label.toLowerCase()}.</p>}
    {grouped.same.length > 0 && <details className="rounded-lg border border-[var(--border-subtle)]"><summary className="cursor-pointer px-3 py-2 text-[8px] text-[var(--text-subtle)]">Unchanged ({grouped.same.length})</summary><div className="border-t border-[var(--border-subtle)] p-2"><ChangeRows changes={grouped.same} leftLabel={leftLabel} rightLabel={rightLabel} /></div></details>}
  </div>
}

function ChangeSection({ title, tone, changes, leftLabel, rightLabel }: { title: string; tone: string; changes: ApkCompareCategory['changes']; leftLabel: string; rightLabel: string }) {
  return <section className="min-w-0 rounded-lg border border-[var(--border-subtle)]"><h3 className={`border-b border-[var(--border-subtle)] px-3 py-2 text-[9px] font-bold ${tone}`}>{title} ({changes.length})</h3><div className="max-h-72 overflow-auto p-2">{changes.length ? <ChangeRows changes={changes} leftLabel={leftLabel} rightLabel={rightLabel} /> : <p className="py-5 text-center text-[8px] text-[var(--text-subtle)]">None</p>}</div></section>
}

function ChangeRows({ changes, leftLabel, rightLabel }: { changes: ApkCompareCategory['changes']; leftLabel: string; rightLabel: string }) {
  const display = (key: string, value?: string) => key.toLowerCase().includes('size') || key.toLowerCase().includes('compressed') ? formatPackageBytes(value === undefined ? undefined : Number(value)) : value ?? '—'
  return <div className="space-y-1">{changes.map((change) => <div key={change.key} className="rounded-md bg-black/10 p-2"><p className="break-all font-mono text-[8px] font-semibold text-[var(--text-base)]">{change.label}</p>{change.kind === 'changed' && <div className="mt-1 grid grid-cols-2 gap-2 text-[8px]"><span className="break-all text-red-300" title={leftLabel}>{display(change.key, change.before)}</span><span className="break-all text-emerald-300" title={rightLabel}>{display(change.key, change.after)}</span></div>}</div>)}</div>
}
