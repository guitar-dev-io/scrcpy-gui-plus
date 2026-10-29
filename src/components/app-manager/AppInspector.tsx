import {
  Archive,
  Ban,
  Braces,
  Database,
  Download,
  Eraser,
  FileJson,
  Files,
  GitCompareArrows,
  Loader2,
  PackageMinus,
  Play,
  ScrollText,
  ScanSearch,
  Settings,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { AppActionId, PackageEntry, PackageInfoResult } from '../../types/appManager'
import { formatPackageBytes, packageDisplayName } from '../../utils/appManagerView'
import { useI18n } from '../../i18n'
import { AppIcon } from './AppIcon'

interface AppInspectorProps {
  pkg?: PackageEntry
  deviceSerial: string
  customPath?: string
  info?: PackageInfoResult
  loading: boolean
  busy: (action: AppActionId) => boolean
  onAction: (action: AppActionId) => void
  onClearCache: () => void
  onOpenLogcat?: () => void
  onOpenShell?: () => void
  onPullApk?: () => void
  pullingApk?: boolean
  onShowPackageInfo: () => void
  onOpenSplitApks: () => void
  onOpenApkInspector: () => void
  onOpenApkCompare: () => void
  onOpenApkBackup: () => void
  onClose?: () => void
}

export function AppInspector({
  pkg,
  deviceSerial,
  customPath,
  info,
  loading,
  busy,
  onAction,
  onClearCache,
  onOpenLogcat,
  onOpenShell,
  onPullApk,
  pullingApk = false,
  onShowPackageInfo,
  onOpenSplitApks,
  onOpenApkInspector,
  onOpenApkCompare,
  onOpenApkBackup,
  onClose,
}: AppInspectorProps) {
  const { t } = useI18n()
  const yesNo = (value?: boolean) => value === undefined ? '—' : value ? t('appManagerUi.yes') : t('appManagerUi.no')
  if (!pkg) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[var(--text-subtle)]">
        <FileJson size={24} />
        <p className="mt-3 text-[13px] font-semibold text-[var(--text-muted)]">{t('appManagerUi.noAppSelected')}</p>
        <p className="mt-1 text-[11px]">{t('appManagerUi.selectAppHint')}</p>
      </div>
    )
  }

  const name = packageDisplayName(pkg.packageName)
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <h2 className="text-[14px] font-semibold text-[var(--text-base)]">{t('appManagerUi.inspectorTitle')}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]" aria-label={t('appManagerUi.closeInspector')}>
            <X size={14} />
          </button>
        )}
      </header>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <AppIcon serial={deviceSerial} packageName={pkg.packageName} customPath={customPath} eager />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold text-[var(--text-base)]">{name}</h3>
            <p className="truncate text-[11px] text-[var(--text-subtle)]" title={pkg.packageName}>{pkg.packageName}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={pkg.system ? 'warning' : 'primary'}>{pkg.system ? t('appManagerUi.systemApp') : t('appManagerUi.userApp')}</Badge>
              <Badge tone={pkg.running ? 'success' : 'neutral'}>{pkg.running ? t('appManagerUi.statusRunning') : pkg.enabled ? t('appManagerUi.statusIdle') : t('appManagerUi.statusDisabled')}</Badge>
            </div>
          </div>
        </div>

        <section className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-label={t('appManagerUi.packageDetailsAria')}>
          {loading ? <InspectorSkeleton /> : (
            <dl className="space-y-2.5 text-[12px]">
              <Detail label={t('appManagerUi.detailVersion')} value={info?.versionName} />
              <Detail label={t('appManagerUi.detailVersionCode')} value={info?.versionCode} />
              <Detail label={t('appManagerUi.detailInstalled')} value={info?.firstInstallTime} />
              <Detail label={t('appManagerUi.detailUpdated')} value={info?.lastUpdateTime} />
              <Detail label={t('appManagerUi.detailApkSize')} value={formatPackageBytes(info?.apkSizeBytes)} />
              <Detail label={t('appManagerUi.detailDataSize')} value={formatPackageBytes(info?.dataSizeBytes)} />
              <Detail label="UID" value={info?.uid} />
              <Detail label={t('appManagerUi.detailTargetSdk')} value={info?.targetSdk} />
              <Detail label={t('appManagerUi.detailMinSdk')} value={info?.minSdk} />
              <Detail label={t('appManagerUi.detailDebuggable')} value={yesNo(info?.debuggable)} />
              <Detail label={t('appManagerUi.detailEnabled')} value={yesNo(info?.enabled ?? pkg.enabled)} />
              <Detail label={t('appManagerUi.detailInstallSource')} value={info?.installSource} mono />
            </dl>
          )}
        </section>

        <InspectorSection title={t('appManagerUi.quickActions')}>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton icon={Play} label={t('appManagerUi.launchApp')} primary busy={busy('launch')} onClick={() => onAction('launch')} />
            <ActionButton icon={Ban} label={t('appManagerUi.forceStop')} danger busy={busy('force_stop')} onClick={() => onAction('force_stop')} />
            <ActionButton icon={Eraser} label={t('appManagerUi.trimCache')} busy={busy('clear_cache')} onClick={onClearCache} title={t('appManagerUi.trimCacheHint')} />
            <ActionButton icon={Trash2} label={t('appManagerUi.clearData')} danger busy={busy('clear_data')} onClick={() => onAction('clear_data')} />
          </div>
        </InspectorSection>

        <InspectorSection title={t('appManagerUi.developerTools')}>
          <div className="grid grid-cols-2 gap-2">
            {onOpenLogcat && <ToolButton icon={ScrollText} label={t('appManagerUi.openLogcat')} onClick={onOpenLogcat} />}
            <ToolButton icon={Terminal} label={t('appManagerUi.shellContext')} onClick={onOpenShell} disabled={!onOpenShell || loading} title={onOpenShell ? t('appManagerUi.shellDraftHint') : t('appManagerUi.shellNeedsDebuggable')} />
            <ToolButton icon={Braces} label={t('appManagerUi.packageInfo')} onClick={onShowPackageInfo} />
            <ToolButton icon={Settings} label={t('appManagerUi.appSettings')} onClick={() => onAction('open_settings')} />
            <ToolButton icon={Download} label={t('appManagerUi.pullApk')} onClick={onPullApk} disabled={!onPullApk || loading} busy={pullingApk} title={onPullApk ? t('appManagerUi.pullHint') : t('appManagerUi.pullUnavailable')} />
            <ToolButton icon={Files} label={t('appManagerUi.splitApks')} onClick={onOpenSplitApks} disabled={loading} title={t('appManagerUi.splitApksHint')} />
            <ToolButton icon={ScanSearch} label={t('appManagerUi.inspectApk')} onClick={onOpenApkInspector} title={t('appManagerUi.inspectApkHint')} />
            <ToolButton icon={GitCompareArrows} label={t('appManagerUi.compareApks')} onClick={onOpenApkCompare} title={t('appManagerUi.compareApksHint')} />
            <ToolButton icon={Archive} label={t('appManagerUi.backupApkSet')} onClick={onOpenApkBackup} disabled={loading} title={t('appManagerUi.backupApkSetHint')} />
            <ToolButton icon={Database} label={t('appManagerUi.openAppData')} disabled title={t('appManagerUi.openAppDataHint')} />
          </div>
        </InspectorSection>

        <section className="border-t border-[var(--border-subtle)] pt-4">
          <h4 className="mb-2 text-[11px] font-semibold text-red-400">{t('appManagerUi.destructiveAction')}</h4>
          <button type="button" onClick={() => onAction('uninstall')} disabled={pkg.system || busy('uninstall')} title={pkg.system ? t('appManagerUi.systemUninstallHint') : t('appManagerUi.uninstallHint')} className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-red-500/35 bg-red-500/10 text-[11px] font-semibold text-red-400 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:border-[var(--border-base)] disabled:bg-transparent disabled:text-[var(--text-subtle)] disabled:opacity-60">
            {busy('uninstall') ? <Loader2 size={12} className="animate-spin" /> : <PackageMinus size={12} />}
            {pkg.system ? t('appManagerUi.systemUninstallUnavailable') : t('appManagerUi.uninstallApp')}
          </button>
        </section>
      </div>
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  const { t } = useI18n()
  return <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-[var(--text-subtle)]">{label}</dt><dd className={`min-w-0 truncate text-right text-[var(--text-muted)] ${mono ? 'font-mono text-[11px]' : ''}`} title={value || t('appManagerUi.unavailable')}>{value || '—'}</dd></div>
}

function Badge({ tone, children }: { tone: 'primary' | 'success' | 'warning' | 'neutral'; children: React.ReactNode }) {
  const style = { primary: 'bg-primary/10 text-primary', success: 'bg-emerald-500/10 text-emerald-400', warning: 'bg-amber-500/10 text-amber-400', neutral: 'bg-zinc-500/10 text-zinc-400' }[tone]
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${style}`}>{children}</span>
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4 border-t border-[var(--border-subtle)] pt-4"><h4 className="mb-3 text-[11px] font-semibold text-[var(--text-muted)]">{title}</h4>{children}</section>
}

function ActionButton({ icon: Icon, label, onClick, primary, danger, busy, title }: { icon: typeof Play; label: string; onClick: () => void; primary?: boolean; danger?: boolean; busy: boolean; title?: string }) {
  const style = primary ? 'border-primary bg-primary text-on-primary hover:bg-[var(--primary-hover)]' : danger ? 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/15' : 'border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-base)]'
  return <button type="button" onClick={onClick} disabled={busy} title={title} className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-[11px] font-semibold transition disabled:opacity-40 ${style}`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}{label}</button>
}

function ToolButton({ icon: Icon, label, onClick, disabled, busy, title }: { icon: typeof Settings; label: string; onClick?: () => void; disabled?: boolean; busy?: boolean; title?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled || busy} title={title} className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)] hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}{label}</button>
}

function InspectorSkeleton() {
  const { t } = useI18n()
  return <div className="space-y-2.5" aria-label={t('appManagerUi.loadingDetailsAria')}><div className="h-3 w-full animate-pulse rounded bg-white/5" /><div className="h-3 w-5/6 animate-pulse rounded bg-white/5" /><div className="h-3 w-full animate-pulse rounded bg-white/5" /><div className="h-3 w-2/3 animate-pulse rounded bg-white/5" /></div>
}
