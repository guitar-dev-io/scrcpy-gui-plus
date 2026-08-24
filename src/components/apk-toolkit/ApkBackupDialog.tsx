import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react'
import { createApkSetBackup, validateApkSetArchive } from '../../services/apkBackupService'
import type { ApkBackupProgressStage, ApkSetBackupResult, ApkSetValidationResult } from '../../types/apkBackup'

export interface ApkBackupDialogProps {
  open: boolean
  serial: string
  packageName: string
  customPath?: string
  onClose: () => void
  onOpenPath?: (path: string) => void | Promise<void>
  onValidation?: (result: ApkSetValidationResult) => void
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export function ApkBackupDialog({
  open: isOpen,
  serial,
  packageName,
  customPath,
  onClose,
  onOpenPath,
  onValidation,
}: ApkBackupDialogProps) {
  const [stage, setStage] = useState<ApkBackupProgressStage>()
  const [result, setResult] = useState<ApkSetBackupResult>()
  const [validation, setValidation] = useState<ApkSetValidationResult>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setStage(undefined)
    setResult(undefined)
    setValidation(undefined)
    setError('')
  }, [isOpen, packageName, serial])

  if (!isOpen) return null

  const create = async () => {
    const output = await open({
      directory: true,
      multiple: false,
      title: 'Choose APK Set backup destination',
    })
    if (typeof output !== 'string') return
    setStage('exporting')
    setResult(undefined)
    setValidation(undefined)
    setError('')
    try {
      const next = await createApkSetBackup({
        serial,
        packageName,
        outputDirectory: output,
        customPath,
      })
      setResult(next)
      if (next.validation) {
        setValidation(next.validation)
        onValidation?.(next.validation)
      }
      if (!next.outputPath && next.error) setError(next.error)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setStage(undefined)
    }
  }

  const validate = async () => {
    if (!result?.outputPath) return
    setStage('validating')
    setError('')
    try {
      const next = await validateApkSetArchive(result.outputPath)
      setValidation(next)
      onValidation?.(next)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setStage(undefined)
    }
  }

  const partial = result?.partial === true
  const complete = result?.success === true && !partial
  const tone = partial
    ? 'border-amber-500/25 bg-amber-500/5'
    : complete
      ? 'border-emerald-500/25 bg-emerald-500/5'
      : 'border-red-500/25 bg-red-500/5'

  return (
    <div className="fixed inset-0 z-[390] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Back up APK set for ${packageName}`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Archive size={15} /></span>
            <div className="min-w-0">
              <h2 className="text-[12px] font-semibold text-[var(--text-base)]">APK Set Backup</h2>
              <p className="truncate text-[9px] text-[var(--text-subtle)]">{packageName} · {serial}</p>
            </div>
          </div>
          <button type="button" aria-label="Close APK Set backup" onClick={onClose} className="p-2 text-[var(--text-subtle)]"><X size={15} /></button>
        </header>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold text-amber-300"><AlertTriangle size={14} />App data is not included</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[var(--text-subtle)]">This backup contains the base APK, available split APKs, permissions, signature metadata, hashes, native libraries, and component summaries. It does not contain databases, preferences, cache, accounts, or external app storage.</p>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-[9px] text-[var(--text-subtle)]">
            The resulting <span className="font-mono text-[var(--text-base)]">.apkset</span> file is integrity-checked before it is returned. If a split APK cannot be exported, the result is marked partial and lists the warning.
          </div>

          {stage && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-[10px] text-primary">
              <Loader2 size={14} className="animate-spin" />
              {stage === 'exporting' ? 'Exporting APK files, analyzing, and creating backup…' : 'Reopening and validating archive integrity…'}
            </div>
          )}

          {error && <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-[10px] text-red-400">{error}</p>}

          {result && (
            <div className={`rounded-lg border p-3 ${tone}`}>
              <p className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-base)]">
                {partial ? <AlertTriangle size={14} className="text-amber-400" /> : complete ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertTriangle size={14} className="text-red-400" />}
                {partial ? 'Partial APK Set created' : complete ? 'APK Set backup created' : 'Backup failed'}
              </p>
              <p className="mt-1 text-[9px] text-[var(--text-subtle)]">{result.exportedCount} APK files exported · {result.failedCount} failed · analysis {result.analysisAvailable ? 'included' : 'unavailable'}</p>
              {result.outputPath && <p className="mt-2 break-all font-mono text-[8px] text-[var(--text-muted)]">{result.outputPath}</p>}
              {result.error && <p className="mt-2 text-[9px] text-red-400">{result.error}</p>}
              {result.warnings.length > 0 && <ul aria-label="Backup warnings" className="mt-2 list-disc space-y-1 pl-4 text-[8px] text-amber-300">{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
            </div>
          )}

          {validation && (
            <div className={`rounded-lg border p-3 ${validation.valid ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'}`}>
              <p className={`flex items-center gap-2 text-[10px] font-semibold ${validation.valid ? 'text-emerald-300' : 'text-red-400'}`}><ShieldCheck size={14} />{validation.valid ? 'Archive integrity verified' : 'Archive validation failed'}</p>
              <p className="mt-1 text-[8px] text-[var(--text-subtle)]">{validation.apkCount} APK files · app data {validation.includesAppData ? 'present' : 'excluded'}</p>
              {validation.error && <p className="mt-1 text-[8px] text-red-400">{validation.error}</p>}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] p-3">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-[var(--border-base)] px-4 text-[9px] text-[var(--text-muted)]">Close</button>
          {result?.outputPath && <button type="button" disabled={Boolean(stage)} onClick={() => void validate()} className="flex h-9 items-center gap-2 rounded-md border border-[var(--border-base)] px-3 text-[9px] text-[var(--text-base)] disabled:opacity-40"><ShieldCheck size={13} />Validate</button>}
          {result?.outputPath && onOpenPath && <button type="button" disabled={Boolean(stage)} onClick={() => void onOpenPath(result.outputPath!)} className="flex h-9 items-center gap-2 rounded-md border border-[var(--border-base)] px-3 text-[9px] text-[var(--text-base)] disabled:opacity-40"><ExternalLink size={13} />Open backup</button>}
          <button type="button" disabled={Boolean(stage)} onClick={() => void create()} className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-[9px] font-semibold text-on-primary disabled:opacity-40"><FolderOpen size={13} />{result ? 'Create another backup' : 'Choose folder and create'}</button>
        </footer>
      </section>
    </div>
  )
}
