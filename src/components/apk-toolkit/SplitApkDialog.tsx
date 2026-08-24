import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, PackageOpen, X } from 'lucide-react'
import { discoverPackageApks, extractPackageApks } from '../../services/apkToolkitService'
import type { ApkExtractionProgress, PackageApkDiscoveryResult, PackageApkExtractionResult } from '../../types/apkToolkit'
import { formatPackageBytes } from '../../utils/appManagerView'

export function SplitApkDialog({ open: isOpen, serial, packageName, customPath, onClose }: { open: boolean; serial: string; packageName: string; customPath?: string; onClose: () => void }) {
  const [discovery, setDiscovery] = useState<PackageApkDiscoveryResult>()
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<ApkExtractionProgress>()
  const [result, setResult] = useState<PackageApkExtractionResult>()
  const [mode, setMode] = useState<'folder' | 'base_only' | 'apk_set_zip'>('folder')
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoading(true); setDiscovery(undefined); setResult(undefined); setProgress(undefined)
    void discoverPackageApks(serial, packageName, customPath).then((next) => {
      if (!active) return
      setDiscovery(next)
      setSelected(new Set(next.files.map((file) => file.path)))
    }).catch((error) => {
      if (active) setDiscovery({ success: false, packageName, files: [], error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [customPath, isOpen, packageName, serial])
  const selectedFiles = useMemo(() => discovery?.files.filter((file) => selected.has(file.path)) ?? [], [discovery, selected])
  const exportFiles = mode === 'base_only'
    ? discovery?.files.filter((file) => file.isBase).slice(0, 1) ?? []
    : selectedFiles
  if (!isOpen) return null
  const extract = async () => {
    const output = await open({ directory: true, multiple: false, title: 'Extract package APKs' })
    if (typeof output !== 'string') return
    setResult(undefined); setProgress({ completed: 0, total: exportFiles.length })
    try {
      setResult(await extractPackageApks({ serial, packageName, remotePaths: exportFiles.map((file) => file.path), outputDirectory: output, mode, customPath, onProgress: setProgress }))
    } catch (error) {
      setResult({ success: false, packageName, outputDirectory: output, files: [], error: error instanceof Error ? error.message : String(error) })
    } finally { setProgress(undefined) }
  }
  const failed = result?.files.filter((file) => !file.success) ?? []
  return <div className="fixed inset-0 z-[380] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={`Extract APKs for ${packageName}`} onClick={(event) => event.stopPropagation()} className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div><h2 className="text-[12px] font-semibold text-[var(--text-base)]">Split APK Extractor</h2><p className="text-[9px] text-[var(--text-subtle)]">{packageName}</p></div><button type="button" aria-label="Close split APK extractor" onClick={onClose} className="p-2 text-[var(--text-subtle)]"><X size={15} /></button></header>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? <div aria-label="Discovering package APKs" className="flex items-center justify-center gap-2 py-16 text-[10px] text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" />Discovering base and split APKs…</div> : discovery?.error ? <p className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-[10px] text-red-400">{discovery.error}</p> : discovery?.files.length === 0 ? <p className="py-16 text-center text-[10px] text-[var(--text-subtle)]">No package APK files were reported.</p> : <div className="space-y-2">
          <div className="flex justify-between text-[9px] text-[var(--text-subtle)]"><span>{discovery?.files.length} APK files discovered</span><button type="button" onClick={() => setSelected(selected.size === discovery?.files.length ? new Set() : new Set(discovery?.files.map((file) => file.path)))} className="text-primary">{selected.size === discovery?.files.length ? 'Clear selection' : 'Select all'}</button></div>
          {discovery?.files.map((file) => <label key={file.path} className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] p-3"><input type="checkbox" checked={selected.has(file.path)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(file.path) ? next.delete(file.path) : next.add(file.path); return next })} /><PackageOpen size={14} className={file.isBase ? 'text-primary' : 'text-violet-400'} /><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold text-[var(--text-base)]">{file.name}</span><span className="block truncate font-mono text-[8px] text-[var(--text-subtle)]">{file.splitName ?? (file.isBase ? 'Base APK' : file.path)}</span></span><span className="text-[8px] text-[var(--text-subtle)]">{formatPackageBytes(file.sizeBytes)}</span></label>)}
        </div>}
        {progress && <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3"><div className="flex justify-between text-[9px] text-primary"><span>Extracting APKs…</span><span>{progress.completed}/{progress.total}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></div></div>}
        {result && <div className={`mt-4 rounded-lg border p-3 ${failed.length ? 'border-amber-500/25 bg-amber-500/5' : 'border-emerald-500/25 bg-emerald-500/5'}`}><p className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-base)]">{failed.length ? <AlertTriangle size={14} className="text-amber-400" /> : <CheckCircle2 size={14} className="text-emerald-400" />}{result.files.length - failed.length} extracted, {failed.length} failed</p>{failed.map((file) => <p key={file.remotePath} className="mt-1 truncate text-[8px] text-red-400" title={file.error}>{file.remotePath}: {file.error ?? 'Extraction failed'}</p>)}</div>}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] p-3"><label className="mr-auto flex items-center gap-2 text-[9px] text-[var(--text-subtle)]">Export as<select aria-label="APK export mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="h-9 rounded-md border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 text-[9px] text-[var(--text-muted)]"><option value="folder">Folder</option><option value="base_only">Base APK only</option><option value="apk_set_zip">APK set ZIP</option></select></label><button type="button" onClick={onClose} className="h-9 rounded-md border border-[var(--border-base)] px-4 text-[9px] text-[var(--text-muted)]">Close</button><button type="button" disabled={loading || exportFiles.length === 0 || Boolean(progress)} onClick={() => void extract()} className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[9px] font-semibold text-on-primary disabled:opacity-40"><FolderOpen size={13} />{mode === 'base_only' ? 'Export base APK' : mode === 'apk_set_zip' ? `Export ${exportFiles.length} as ZIP` : `Extract ${exportFiles.length} selected`}</button></footer>
    </section>
  </div>
}
