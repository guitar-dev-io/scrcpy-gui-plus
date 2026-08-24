import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FileArchive, Loader2, Search, X } from 'lucide-react'
import { analyzeApkFile } from '../../services/apkToolkitService'
import type { ApkAnalysisResult } from '../../types/apkToolkit'
import { formatPackageBytes } from '../../utils/appManagerView'

type InspectorTab = 'overview' | 'components' | 'permissions' | 'signatures' | 'native' | 'files' | 'manifest'

export function ApkInspectorDialog({ open: isOpen, initialFilePath, onClose }: { open: boolean; initialFilePath?: string; onClose: () => void }) {
  const [filePath, setFilePath] = useState(initialFilePath)
  const [analysis, setAnalysis] = useState<ApkAnalysisResult>()
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<InspectorTab>('overview')
  const inspect = async (path: string) => {
    setFilePath(path); setLoading(true); setAnalysis(undefined); setTab('overview')
    try { setAnalysis(await analyzeApkFile(path)) }
    catch (error) { setAnalysis({ success: false, filePath: path, permissions: [], activities: [], services: [], receivers: [], providers: [], components: [], nativeAbis: [], nativeLibraries: [], signatures: [], files: [], error: error instanceof Error ? error.message : String(error) }) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (isOpen && initialFilePath) void inspect(initialFilePath)
    if (!isOpen) { setAnalysis(undefined); setFilePath(initialFilePath); setTab('overview') }
    // Inspection is intentionally initiated only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFilePath, isOpen])
  if (!isOpen) return null
  const chooseFile = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Android packages', extensions: ['apk'] }], title: 'Inspect APK file' })
    if (typeof selected === 'string') await inspect(selected)
  }
  const tabs: Array<[InspectorTab, string, number?]> = [
    ['overview', 'Overview'], ['components', 'Components'], ['permissions', 'Permissions', analysis?.permissions.length],
    ['signatures', 'Signing', analysis?.signatures.length], ['native', 'Native', analysis?.nativeLibraries.length], ['files', 'Files', analysis?.files.length], ['manifest', 'Manifest'],
  ]
  return <div className="fixed inset-0 z-[380] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="APK Inspector" onClick={(event) => event.stopPropagation()} className="flex h-[min(780px,86vh)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div className="min-w-0"><h2 className="text-[12px] font-semibold text-[var(--text-base)]">APK Inspector</h2><p className="max-w-xl truncate font-mono text-[8px] text-[var(--text-subtle)]">{filePath ?? 'Choose a local APK to inspect'}</p></div><div className="flex gap-2"><button type="button" onClick={() => void chooseFile()} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-3 text-[9px] text-[var(--text-muted)]"><Search size={12} />Choose APK</button><button type="button" aria-label="Close APK Inspector" onClick={onClose} className="p-2 text-[var(--text-subtle)]"><X size={15} /></button></div></header>
      {!filePath && !loading ? <div className="flex flex-1 flex-col items-center justify-center"><FileArchive size={30} className="text-[var(--text-subtle)]" /><p className="mt-3 text-[10px] text-[var(--text-muted)]">Analysis stays idle until you choose a file.</p><button type="button" onClick={() => void chooseFile()} className="mt-3 rounded-md bg-primary px-4 py-2 text-[9px] font-semibold text-on-primary">Choose APK file</button></div> : loading ? <div aria-label="Analyzing APK" className="flex flex-1 items-center justify-center gap-2 text-[10px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" />Analyzing APK locally…</div> : analysis?.error ? <div className="m-4 rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-[10px] text-red-400">{analysis.error}</div> : analysis && <>
        <nav role="tablist" aria-label="APK analysis sections" className="custom-scrollbar flex shrink-0 overflow-x-auto border-b border-[var(--border-subtle)] px-3">{tabs.map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-10 shrink-0 border-b-2 px-3 text-[9px] font-semibold ${tab === id ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)]'}`}>{label}{count !== undefined ? ` (${count})` : ''}</button>)}</nav>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">
          {tab === 'overview' && <Overview analysis={analysis} />}
          {tab === 'components' && <Components analysis={analysis} />}
          {tab === 'permissions' && <StringList values={analysis.permissions} empty="No permissions reported" />}
          {tab === 'signatures' && <SigningDetails analysis={analysis} />}
          {tab === 'native' && <NativeLibraries analysis={analysis} />}
          {tab === 'files' && <div className="space-y-1">{analysis.files.map((file) => <div key={file.path} className="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-3 rounded-md px-2 py-1.5 text-[9px] odd:bg-white/[0.025]"><span className="truncate font-mono text-[var(--text-muted)]">{file.path}</span><span className="text-right text-[var(--text-subtle)]">{formatPackageBytes(file.sizeBytes)}</span><span className="text-right text-[var(--text-subtle)]">{formatPackageBytes(file.compressedSizeBytes)}</span></div>)}</div>}
          {tab === 'manifest' && <pre className="whitespace-pre-wrap break-words font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">{analysis.rawManifest ?? 'Raw manifest unavailable.'}</pre>}
        </div>
      </>}
    </section>
  </div>
}

function Overview({ analysis }: { analysis: ApkAnalysisResult }) {
  const rows = [['File', analysis.fileName], ['File size', formatPackageBytes(analysis.fileSizeBytes)], ['SHA-256', analysis.sha256], ['Application', analysis.applicationLabel], ['Package', analysis.packageName], ['Version', analysis.versionName], ['Version code', analysis.versionCode], ['Minimum SDK', analysis.minSdk], ['Target SDK', analysis.targetSdk], ['Compile SDK', analysis.compileSdk], ['Debuggable', analysis.debuggable === undefined ? undefined : analysis.debuggable ? 'Yes' : 'No']]
  return <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[9px]">{rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-[var(--text-subtle)]">{label}</dt><dd className="break-all text-[var(--text-muted)]">{value ?? '—'}</dd></div>)}</dl>
}

function Components({ analysis }: { analysis: ApkAnalysisResult }) {
  return <div className="space-y-4">{([['Activities', analysis.activities], ['Services', analysis.services], ['Receivers', analysis.receivers], ['Providers', analysis.providers]] as const).map(([label, values]) => <section key={label}><h3 className="mb-1 text-[9px] font-bold text-[var(--text-base)]">{label} ({values.length})</h3><StringList values={values} empty={`No ${label.toLowerCase()} reported`} /></section>)}</div>
}

function StringList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <ul className="space-y-1">{values.map((value) => <li key={value} className="rounded-md bg-black/15 px-2 py-1.5 font-mono text-[9px] text-[var(--text-muted)]">{value}</li>)}</ul> : <p className="py-8 text-center text-[9px] text-[var(--text-subtle)]">{empty}</p>
}

function SignatureList({ values }: { values: Array<Record<string, string>> }) {
  return values.length ? <div className="space-y-3">{values.map((signature, index) => <dl key={index} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--border-subtle)] p-3 text-[9px]">{Object.entries(signature).map(([key, value]) => <div key={key} className="contents"><dt className="text-[var(--text-subtle)]">{key}</dt><dd className="break-all font-mono text-[var(--text-muted)]">{value}</dd></div>)}</dl>)}</div> : <p className="py-8 text-center text-[9px] text-[var(--text-subtle)]">No signatures reported</p>
}

function SigningDetails({ analysis }: { analysis: ApkAnalysisResult }) {
  return <div className="space-y-4"><dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-[9px]"><dt className="text-[var(--text-subtle)]">Status</dt><dd className="text-[var(--text-muted)]">{analysis.signing?.status ?? 'unknown'}</dd><dt className="text-[var(--text-subtle)]">Schemes</dt><dd className="text-[var(--text-muted)]">{analysis.signing?.schemes.join(', ') || '—'}</dd><dt className="text-[var(--text-subtle)]">Signature entries</dt><dd className="break-all font-mono text-[var(--text-muted)]">{analysis.signing?.signatureEntries.join(', ') || '—'}</dd></dl>{analysis.signing?.reason && <p className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-400">{analysis.signing.reason}</p>}<SignatureList values={analysis.signatures} /></div>
}

function NativeLibraries({ analysis }: { analysis: ApkAnalysisResult }) {
  return <div><p className="mb-3 text-[9px] text-[var(--text-subtle)]">ABIs: {analysis.nativeAbis.join(', ') || 'None'}</p>{analysis.nativeLibraries.length ? <div className="space-y-1">{analysis.nativeLibraries.map((library) => <div key={library.archivePath} className="grid grid-cols-[80px_minmax(0,1fr)_80px] gap-3 rounded-md px-2 py-1.5 text-[9px] odd:bg-white/[0.025]"><span className="text-primary">{library.abi}</span><span className="truncate font-mono text-[var(--text-muted)]" title={library.archivePath}>{library.name}</span><span className="text-right text-[var(--text-subtle)]">{formatPackageBytes(library.sizeBytes)}</span></div>)}</div> : <p className="py-8 text-center text-[9px] text-[var(--text-subtle)]">No native libraries</p>}</div>
}
