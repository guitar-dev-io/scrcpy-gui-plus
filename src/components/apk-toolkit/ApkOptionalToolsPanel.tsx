import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { Braces, CircleAlert, CircleCheck, FileCog, FolderCog, Info, Loader2, PackageOpen, Square, Trash2, X } from 'lucide-react'
import {
  cancelApkOptionalToolJob,
  configureApkOptionalToolPath,
  cleanupApkOptionalToolJob,
  configureApkOptionalTools,
  detectApkOptionalTools,
  getApkOptionalToolJob,
  startApkOptionalToolJob,
} from '../../services/apkOptionalToolsService'
import type { ApkOptionalTool, ApkOptionalToolJobStatus, ApkOptionalToolsDetection } from '../../types/apkOptionalTools'
import { formatPackageBytes } from '../../utils/appManagerView'

const terminal = (state?: string) => ['succeeded', 'failed', 'cancelled'].includes(state ?? '')

export function ApkOptionalToolsPanel({ apkPath }: { apkPath?: string }) {
  const [detection, setDetection] = useState<ApkOptionalToolsDetection>()
  const [job, setJob] = useState<ApkOptionalToolJobStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const detect = async () => {
    setBusy(true); setError('')
    try { setDetection(await detectApkOptionalTools()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void detect() }, [])
  useEffect(() => {
    if (!job || terminal(job.state)) return
    const timer = window.setInterval(() => {
      void getApkOptionalToolJob(job.jobId).then(setJob).catch(() => undefined)
    }, 750)
    return () => window.clearInterval(timer)
  }, [job])

  const configure = async () => {
    const directory = await open({ directory: true, multiple: false, title: 'Choose jadx / apktool directory' })
    if (typeof directory !== 'string') return
    await configureApkOptionalTools(directory)
    await detect()
  }
  const configureFile = async (tool: ApkOptionalTool) => {
    const path = await open({
      directory: false,
      multiple: false,
      title: tool === 'apktool' ? 'Choose apktool executable or JAR' : 'Choose JADX CLI executable',
    })
    if (typeof path !== 'string') return
    setBusy(true); setError('')
    try {
      await configureApkOptionalToolPath(tool, path)
      await detect()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }
  const clearFile = async (tool: ApkOptionalTool) => {
    setBusy(true); setError('')
    try {
      await configureApkOptionalToolPath(tool)
      await detect()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }
  const start = async (tool: ApkOptionalTool) => {
    if (!apkPath) return
    setBusy(true); setError('')
    try { setJob(await startApkOptionalToolJob(tool, apkPath)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!job || !terminal(job.state)) return
    await cleanupApkOptionalToolJob(job.jobId)
    setJob(undefined)
  }

  return <section className="mt-5 rounded-xl border border-[var(--border-subtle)] p-3" aria-label="Optional APK tools">
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-[10px] font-bold">Optional JADX / Apktool</h3><p className="text-[8px] text-[var(--text-subtle)]">Core inspection works without these external tools.</p></div><button type="button" onClick={() => void configure()} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2 text-[8px] text-[var(--text-muted)]"><FolderCog size={11} />Tool folder</button></div>
    {busy && <p className="mt-3 flex items-center gap-2 text-[8px] text-primary"><Loader2 size={11} className="animate-spin" />Checking optional tools…</p>}
    {error && <p className="mt-3 text-[8px] text-red-400">{error}</p>}
    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2.5" role="region" aria-label="Optional tool requirements">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold"><Info size={11} className="text-primary" />Requirements</p>
      <div className="mt-2 flex items-start gap-1.5 text-[8px]">
        {detection?.javaRuntime.available
          ? <CircleCheck size={11} className="mt-px shrink-0 text-emerald-400" />
          : <CircleAlert size={11} className="mt-px shrink-0 text-amber-400" />}
        <div><p className="font-medium">Java runtime</p><p className="text-[var(--text-subtle)]">{detection?.javaRuntime.available ? detection.javaRuntime.version || 'Detected on PATH' : detection?.javaRuntime.reason || 'Checking Java on PATH…'}</p></div>
      </div>
      <ul className="mt-2 space-y-1 pl-4 text-[8px] text-[var(--text-subtle)] marker:text-primary">
        <li className="list-disc"><span className="text-[var(--text-muted)]">Apktool:</span> Java 8+; choose <code>apktool*.jar</code> or the <code>apktool</code> CLI wrapper.</li>
        <li className="list-disc"><span className="text-[var(--text-muted)]">JADX:</span> 64-bit Java 11+; unpack JADX and choose <code>bin/jadx</code> or <code>bin/jadx.bat</code>, not JADX GUI.</li>
        <li className="list-disc">On macOS/Linux, CLI wrapper files must have execute permission.</li>
      </ul>
      <p className="mt-2 text-[7px] text-[var(--text-subtle)]">APK inspection, verification, comparison, and extraction continue to work without these optional tools.</p>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">{detection?.tools.map((tool) => <div key={tool.tool} className="rounded-lg border border-[var(--border-subtle)] p-2"><p className="flex items-center gap-1.5 text-[9px] font-semibold"><Braces size={11} className={tool.available ? 'text-emerald-400' : 'text-[var(--text-subtle)]'} />{tool.tool}</p><p className="mt-1 truncate text-[7px] text-[var(--text-subtle)]" title={tool.reason}>{tool.available ? tool.version || 'Available' : tool.reason || 'Not installed'}</p>{tool.configuredPath && <p className="mt-1 truncate text-[7px] text-primary" title={tool.configuredPath}>{tool.configuredPath}</p>}<div className="mt-2 flex gap-1"><button type="button" aria-label={`Choose ${tool.tool} file`} onClick={() => void configureFile(tool.tool)} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-[var(--border-base)] text-[8px] text-[var(--text-muted)]"><FileCog size={10} />File</button>{tool.configuredPath && <button type="button" aria-label={`Clear ${tool.tool} file`} onClick={() => void clearFile(tool.tool)} className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border-base)] text-[var(--text-subtle)]"><X size={10} /></button>}</div><button type="button" disabled={!tool.available || !apkPath || Boolean(job && !terminal(job.state))} onClick={() => void start(tool.tool)} className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded bg-primary/10 text-[8px] font-semibold text-primary disabled:opacity-30"><PackageOpen size={10} />Run</button></div>)}</div>
    {job && <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2"><div className="flex items-center justify-between"><p className="text-[8px] font-semibold">{job.tool} · {job.state}</p><div className="flex gap-1">{!terminal(job.state) && <button type="button" aria-label="Cancel optional tool job" onClick={() => void cancelApkOptionalToolJob(job.jobId)} className="p-1 text-amber-400"><Square size={10} /></button>}{terminal(job.state) && <button type="button" aria-label="Remove optional tool output" onClick={() => void remove()} className="p-1 text-red-400"><Trash2 size={10} /></button>}</div></div><p className="mt-1 text-[7px] text-[var(--text-subtle)]">{job.outputFiles} files · {formatPackageBytes(job.outputBytes)}</p>{job.state === 'succeeded' && <button type="button" onClick={() => void invoke('open_path', { path: job.outputDirectory })} className="mt-2 text-[8px] text-primary underline">Open generated output</button>}{job.error && <p className="mt-1 text-[8px] text-red-400">{job.error}</p>}{job.logTail && <pre className="custom-scrollbar mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[7px] text-[var(--text-subtle)]">{job.logTail}</pre>}</div>}
  </section>
}
