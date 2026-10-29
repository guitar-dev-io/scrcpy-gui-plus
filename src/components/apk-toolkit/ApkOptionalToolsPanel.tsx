import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../../i18n'
import { Braces, CircleAlert, CircleCheck, Download, FileCog, FolderCog, Info, Loader2, PackageOpen, Square, Trash2, X } from 'lucide-react'
import {
  cancelApkOptionalToolJob,
  configureApkOptionalToolPath,
  cleanupApkOptionalToolJob,
  configureApkOptionalTools,
  detectApkOptionalTools,
  getApkOptionalToolJob,
  installApkOptionalTools,
  onApkOptionalToolsInstallProgress,
  startApkOptionalToolJob,
} from '../../services/apkOptionalToolsService'
import type { ApkOptionalTool, ApkOptionalToolJobStatus, ApkOptionalToolsDetection, ApkOptionalToolsInstallProgress } from '../../types/apkOptionalTools'
import { formatPackageBytes } from '../../utils/appManagerView'

const withCode = (text: string) => text.split('`').map((part, index) => index % 2 ? <code key={index}>{part}</code> : part)

const terminal = (state?: string) => ['succeeded', 'failed', 'cancelled'].includes(state ?? '')

export function ApkOptionalToolsPanel({ apkPath }: { apkPath?: string }) {
  const { t } = useI18n()
  const [detection, setDetection] = useState<ApkOptionalToolsDetection>()
  const [job, setJob] = useState<ApkOptionalToolJobStatus>()
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<ApkOptionalToolsInstallProgress>()
  const [error, setError] = useState('')

  const detect = async () => {
    setBusy(true); setError('')
    try { setDetection(await detectApkOptionalTools()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void detect() }, [])
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onApkOptionalToolsInstallProgress(setInstallProgress)
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [])
  useEffect(() => {
    if (!job || terminal(job.state)) return
    const timer = window.setInterval(() => {
      void getApkOptionalToolJob(job.jobId).then(setJob).catch(() => undefined)
    }, 750)
    return () => window.clearInterval(timer)
  }, [job])

  const configure = async () => {
    const directory = await open({ directory: true, multiple: false, title: t('apkToolkit.optionalPickDirectory') })
    if (typeof directory !== 'string') return
    await configureApkOptionalTools(directory)
    await detect()
  }
  const install = async () => {
    setInstalling(true); setError(''); setInstallProgress(undefined)
    try {
      await installApkOptionalTools()
      await detect()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setInstalling(false)
    }
  }
  const configureFile = async (tool: ApkOptionalTool) => {
    const path = await open({
      directory: false,
      multiple: false,
      title: tool === 'apktool' ? t('apkToolkit.optionalPickApktool') : t('apkToolkit.optionalPickJadx'),
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

  const managedReady = detection?.tools.every((tool) => tool.available && tool.managed) ?? false
  const progressPercent = installProgress?.totalBytes
    ? Math.min(100, Math.round(installProgress.downloadedBytes / installProgress.totalBytes * 100))
    : undefined

  return <section className="mt-5 rounded-xl border border-[var(--border-subtle)] p-3" aria-label={t('apkToolkit.optionalAria')}>
    <div className="flex items-center justify-between gap-3"><div><h3 className="text-[10px] font-bold">{t('apkToolkit.optionalTitle')}</h3><p className="text-[8px] text-[var(--text-subtle)]">{t('apkToolkit.optionalCoreWorks')}</p></div><div className="flex gap-1.5"><button type="button" onClick={() => void install()} disabled={installing || busy} className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[8px] font-semibold text-on-primary disabled:opacity-40"><Download size={11} />{installing ? t('apkToolkit.optionalInstalling') : managedReady ? t('apkToolkit.optionalReinstall') : t('apkToolkit.optionalInstall')}</button><button type="button" onClick={() => void configure()} disabled={installing} className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2 text-[8px] text-[var(--text-muted)] disabled:opacity-40"><FolderCog size={11} />{t('apkToolkit.optionalToolFolder')}</button></div></div>
    {installProgress && (installing || installProgress.phase === 'failed') && <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5" role="status" aria-label={t('apkToolkit.optionalProgressAria')}><div className="flex items-center justify-between gap-3 text-[8px]"><span className="truncate text-[var(--text-muted)]">{installProgress.message}</span><span className="shrink-0 tabular-nums text-primary">{progressPercent !== undefined ? `${progressPercent}%` : `${installProgress.completedTools}/${installProgress.totalTools}`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full bg-primary transition-all" style={{ width: `${progressPercent ?? installProgress.completedTools / Math.max(1, installProgress.totalTools) * 100}%` }} /></div></div>}
    {busy && <p className="mt-3 flex items-center gap-2 text-[8px] text-primary"><Loader2 size={11} className="animate-spin" />{t('apkToolkit.optionalChecking')}</p>}
    {error && <p className="mt-3 text-[8px] text-red-400">{error}</p>}
    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2.5" role="region" aria-label={t('apkToolkit.optionalRequirementsAria')}>
      <p className="flex items-center gap-1.5 text-[9px] font-semibold"><Info size={11} className="text-primary" />{t('apkToolkit.optionalRequirements')}</p>
      <div className="mt-2 flex items-start gap-1.5 text-[8px]">
        {detection?.javaRuntime.available
          ? <CircleCheck size={11} className="mt-px shrink-0 text-emerald-400" />
          : <CircleAlert size={11} className="mt-px shrink-0 text-amber-400" />}
        <div><p className="font-medium">{t('apkToolkit.optionalJava')}</p><p className="text-[var(--text-subtle)]">{detection?.javaRuntime.available ? detection.javaRuntime.version || t('apkToolkit.optionalJavaDetected') : detection?.javaRuntime.reason || t('apkToolkit.optionalJavaChecking')}</p></div>
      </div>
      <ul className="mt-2 space-y-1 pl-4 text-[8px] text-[var(--text-subtle)] marker:text-primary">
        <li className="list-disc"><span className="text-[var(--text-muted)]">Apktool:</span> {withCode(t('apkToolkit.optionalApktoolReq'))}</li>
        <li className="list-disc"><span className="text-[var(--text-muted)]">JADX:</span> {withCode(t('apkToolkit.optionalJadxReq'))}</li>
        <li className="list-disc">{t('apkToolkit.optionalExecPermission')}</li>
      </ul>
      <p className="mt-2 text-[7px] text-[var(--text-subtle)]">{t('apkToolkit.optionalWorksWithout')}</p>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">{detection?.tools.map((tool) => <div key={tool.tool} className="rounded-lg border border-[var(--border-subtle)] p-2"><p className="flex items-center gap-1.5 text-[9px] font-semibold"><Braces size={11} className={tool.available ? 'text-emerald-400' : 'text-[var(--text-subtle)]'} />{tool.tool}{tool.managed && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[7px] font-medium text-emerald-400">{t('apkToolkit.optionalManaged')}</span>}</p><p className="mt-1 truncate text-[7px] text-[var(--text-subtle)]" title={tool.reason}>{tool.available ? tool.version || t('apkToolkit.optionalAvailable') : tool.reason || t('apkToolkit.optionalNotInstalled')}</p>{tool.configuredPath && <p className="mt-1 truncate text-[7px] text-primary" title={tool.configuredPath}>{tool.configuredPath}</p>}<div className="mt-2 flex gap-1"><button type="button" aria-label={t('apkToolkit.optionalChooseFileAria', { tool: tool.tool })} disabled={installing} onClick={() => void configureFile(tool.tool)} className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-[var(--border-base)] text-[8px] text-[var(--text-muted)] disabled:opacity-40"><FileCog size={10} />{t('apkToolkit.optionalFile')}</button>{tool.configuredPath && <button type="button" aria-label={t('apkToolkit.optionalClearFileAria', { tool: tool.tool })} disabled={installing} onClick={() => void clearFile(tool.tool)} className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border-base)] text-[var(--text-subtle)] disabled:opacity-40"><X size={10} /></button>}</div><button type="button" disabled={installing || !tool.available || !apkPath || Boolean(job && !terminal(job.state))} onClick={() => void start(tool.tool)} className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded bg-primary/10 text-[8px] font-semibold text-primary disabled:opacity-30"><PackageOpen size={10} />{t('apkToolkit.optionalRun')}</button></div>)}</div>
    {job && <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2"><div className="flex items-center justify-between"><p className="text-[8px] font-semibold">{job.tool} · {job.state}</p><div className="flex gap-1">{!terminal(job.state) && <button type="button" aria-label={t('apkToolkit.optionalCancelAria')} onClick={() => void cancelApkOptionalToolJob(job.jobId)} className="p-1 text-amber-400"><Square size={10} /></button>}{terminal(job.state) && <button type="button" aria-label={t('apkToolkit.optionalRemoveAria')} onClick={() => void remove()} className="p-1 text-red-400"><Trash2 size={10} /></button>}</div></div><p className="mt-1 text-[7px] text-[var(--text-subtle)]">{t('apkToolkit.optionalJobFiles', { files: job.outputFiles, size: formatPackageBytes(job.outputBytes) })}</p>{job.state === 'succeeded' && <button type="button" onClick={() => void invoke('open_path', { path: job.outputDirectory })} className="mt-2 text-[8px] text-primary underline">{t('apkToolkit.optionalOpenOutput')}</button>}{job.error && <p className="mt-1 text-[8px] text-red-400">{job.error}</p>}{job.logTail && <pre className="custom-scrollbar mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[7px] text-[var(--text-subtle)]">{job.logTail}</pre>}</div>}
  </section>
}
