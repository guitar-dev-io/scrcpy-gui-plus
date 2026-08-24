import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Archive, Boxes, FileArchive, FolderOpen, Hash, Loader2, Scale, ShieldCheck, Smartphone } from 'lucide-react'
import { ApkCompareDialog } from '../apk-toolkit/ApkCompareDialog'
import { ApkInspectorDialog } from '../apk-toolkit/ApkInspectorDialog'
import { ApkOptionalToolsPanel } from '../apk-toolkit/ApkOptionalToolsPanel'
import { analyzeApkFile } from '../../services/apkToolkitService'
import { loadRecentApkFiles, rememberApkFile } from '../../services/localApkToolkitService'
import type { ApkAnalysisResult, RecentApkFile } from '../../types/apkToolkit'
import { formatPackageBytes } from '../../utils/appManagerView'

interface LocalApkToolkitPageProps {
  onInstallCurrent?: (path: string) => void | Promise<void>
  onInstallSelected?: (path: string) => void | Promise<void>
  onInstallGroup?: (path: string) => void | Promise<void>
  onExtractContents?: (path: string, analysis: ApkAnalysisResult) => void | Promise<void>
  onCompareInstalled?: (path: string, analysis: ApkAnalysisResult) => void
}

type DetailMode = 'summary' | 'verify' | 'hash'

export default function LocalApkToolkitPage({ onInstallCurrent, onInstallSelected, onInstallGroup, onExtractContents, onCompareInstalled }: LocalApkToolkitPageProps) {
  const [recent, setRecent] = useState<RecentApkFile[]>(loadRecentApkFiles)
  const [analysis, setAnalysis] = useState<ApkAnalysisResult>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [detail, setDetail] = useState<DetailMode>('summary')
  const [compareOpen, setCompareOpen] = useState(false)

  const inspectPath = async (path: string) => {
    if (!/\.apk$/i.test(path)) { setError('Choose an APK file. APK Set archives can be validated from App Manager backups.'); return }
    setLoading(true); setError(undefined); setDetail('summary')
    try {
      const result = await analyzeApkFile(path)
      setAnalysis(result)
      setRecent((current) => rememberApkFile(path, current))
      if (result.error) setError(result.error)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }
  const chooseApk = async () => {
    const selected = await open({ multiple: false, filters: [{ name: 'Android package', extensions: ['apk'] }], title: 'Open local APK' })
    if (typeof selected === 'string') await inspectPath(selected)
  }
  const drop = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false)
    const file = event.dataTransfer.files[0] as File & { path?: string }
    const path = file?.path
    if (path) void inspectPath(path)
    else setError('The dropped file path is unavailable in this environment.')
  }
  const signingStatus = analysis?.signing?.status ?? 'unknown'

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-base)] p-4 text-[var(--text-base)]">
    <header className="mb-4 flex shrink-0 items-center justify-between"><div><h1 className="text-lg font-bold">APK Toolkit</h1><p className="text-[10px] text-[var(--text-subtle)]">Inspect and compare local Android packages without connecting a device.</p></div><button type="button" onClick={() => void chooseApk()} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary"><FolderOpen size={14} />Open APK</button></header>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="custom-scrollbar min-h-0 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <button type="button" onClick={() => void chooseApk()} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop} className={`flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed p-4 transition ${dragging ? 'border-primary bg-primary/10' : 'border-[var(--border-base)] bg-black/10'}`} aria-label="Drop APK or open file"><FileArchive size={26} className="text-primary" /><span className="mt-2 text-[10px] font-semibold">Drop APK here</span><span className="mt-1 text-[8px] text-[var(--text-subtle)]">or click to browse</span></button>
        <h2 className="mb-2 mt-5 text-[9px] font-bold text-[var(--text-muted)]">Recent files</h2>
        <div className="space-y-1">{recent.map((file) => <button key={file.path} type="button" onClick={() => void inspectPath(file.path)} title={file.path} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-[var(--bg-hover)]"><Archive size={12} className="shrink-0 text-[var(--text-subtle)]" /><span className="min-w-0 flex-1"><span className="block truncate text-[9px] text-[var(--text-muted)]">{file.fileName}</span><span className="block text-[7px] text-[var(--text-subtle)]">{new Date(file.openedAt).toLocaleString()}</span></span></button>)}{recent.length === 0 && <p className="py-5 text-center text-[8px] text-[var(--text-subtle)]">No recent APK files</p>}</div>
      </aside>
      <main className="custom-scrollbar min-h-0 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        {loading ? <div aria-label="Analyzing local APK" className="flex h-full min-h-60 items-center justify-center gap-2 text-[10px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" />Analyzing local package…</div> : !analysis ? <div className="flex h-full min-h-60 flex-col items-center justify-center text-center"><Boxes size={30} className="text-[var(--text-subtle)]" /><h2 className="mt-3 text-[11px] font-semibold">Open a local package to begin</h2><p className="mt-1 text-[9px] text-[var(--text-subtle)]">No Android device is required.</p>{error && <p className="mt-3 text-[9px] text-red-400">{error}</p>}</div> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4"><div className="min-w-0"><h2 className="truncate text-[14px] font-bold">{analysis.applicationLabel ?? analysis.fileName ?? 'Android package'}</h2><p className="truncate font-mono text-[8px] text-[var(--text-subtle)]">{analysis.filePath}</p><p className="mt-1 text-[9px] text-[var(--text-muted)]">{analysis.packageName ?? 'Unknown package'} · {analysis.versionName ?? 'Unknown version'} · {formatPackageBytes(analysis.fileSizeBytes)}</p></div><span className={`rounded-md px-2 py-1 text-[8px] font-semibold ${signingStatus === 'verified' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>Signing: {signingStatus}</span></div>
          {error && <p className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 p-2 text-[9px] text-red-400">{error}</p>}
          <div className="my-4 flex flex-wrap gap-2"><Action label="Inspect" icon={FileArchive} onClick={() => setInspectorOpen(true)} /><Action label="Compare" icon={Scale} onClick={() => setCompareOpen(true)} /><Action label="Verify" icon={ShieldCheck} onClick={() => setDetail('verify')} /><Action label="Hash" icon={Hash} onClick={() => setDetail('hash')} /><Action label="Extract Contents" icon={Archive} disabled={!onExtractContents} title={onExtractContents ? undefined : 'Content extraction backend is unavailable.'} onClick={() => onExtractContents && void onExtractContents(analysis.filePath, analysis)} />{onCompareInstalled && <Action label="Compare Installed" icon={Smartphone} onClick={() => onCompareInstalled(analysis.filePath, analysis)} />}</div>
          <div className="mb-4 flex flex-wrap gap-2"><InstallButton label="Install current" disabled={!onInstallCurrent} onClick={() => onInstallCurrent && void onInstallCurrent(analysis.filePath)} /><InstallButton label="Install selected" disabled={!onInstallSelected} onClick={() => onInstallSelected && void onInstallSelected(analysis.filePath)} /><InstallButton label="Install group" disabled={!onInstallGroup} onClick={() => onInstallGroup && void onInstallGroup(analysis.filePath)} /></div>
          {detail === 'summary' && <Summary analysis={analysis} />}
          {detail === 'verify' && <Verify analysis={analysis} />}
          {detail === 'hash' && <HashView analysis={analysis} />}
          <ApkOptionalToolsPanel apkPath={analysis.filePath} />
        </>}
      </main>
    </div>
    <ApkInspectorDialog open={inspectorOpen} initialFilePath={analysis?.filePath} onClose={() => setInspectorOpen(false)} />
    <ApkCompareDialog open={compareOpen} left={analysis ? { path: analysis.filePath, label: analysis.fileName, origin: 'local' } : undefined} onClose={() => setCompareOpen(false)} />
  </div>
}

function Action({ label, icon: Icon, onClick, disabled, title }: { label: string; icon: typeof FileArchive; onClick: () => void; disabled?: boolean; title?: string }) { return <button type="button" disabled={disabled} title={title} onClick={onClick} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[8px] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary disabled:opacity-35"><Icon size={11} />{label}</button> }
function InstallButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className="rounded-md bg-primary/10 px-3 py-1.5 text-[8px] font-semibold text-primary disabled:opacity-30">{label}</button> }
function Summary({ analysis }: { analysis: ApkAnalysisResult }) { return <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[['Permissions', analysis.permissions.length], ['Components', analysis.components.length], ['Native ABIs', analysis.nativeAbis.length], ['Signing schemes', analysis.signing?.schemes.length ?? 0]].map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3"><p className="text-lg font-bold">{value}</p><p className="text-[8px] text-[var(--text-subtle)]">{label}</p></div>)}</div> }
function Verify({ analysis }: { analysis: ApkAnalysisResult }) { return <section aria-label="APK verification" className="space-y-3"><h3 className="text-[10px] font-bold">Signature inspection</h3><p className="text-[9px] text-[var(--text-muted)]">Status: {analysis.signing?.status ?? 'unknown'}</p><p className="text-[9px] text-[var(--text-muted)]">Schemes detected: {analysis.signing?.schemes.join(', ') || '—'}</p>{analysis.signing?.reason && <p className="text-[9px] text-amber-400">{analysis.signing.reason}</p>}<p className="text-[8px] text-[var(--text-subtle)]">Certificates: {analysis.signatures.length}</p><p className="text-[8px] text-[var(--text-subtle)]">Scheme and certificate metadata are inspected locally; this status is distinct from full cryptographic signature validation.</p></section> }
function HashView({ analysis }: { analysis: ApkAnalysisResult }) { return <section aria-label="APK hash"><h3 className="mb-2 text-[10px] font-bold">SHA-256</h3><code className="block break-all rounded-lg border border-[var(--border-subtle)] bg-black/20 p-3 text-[9px] text-[var(--text-muted)]">{analysis.sha256 ?? 'Hash unavailable'}</code></section> }
