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
  if (!pkg) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[var(--text-subtle)]">
        <FileJson size={24} />
        <p className="mt-3 text-[11px] font-semibold text-[var(--text-muted)]">No app selected</p>
        <p className="mt-1 text-[9px]">Select an app to inspect its package details.</p>
      </div>
    )
  }

  const name = packageDisplayName(pkg.packageName)
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <h2 className="text-[12px] font-semibold text-[var(--text-base)]">App Inspector</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]" aria-label="Close app inspector">
            <X size={14} />
          </button>
        )}
      </header>

      <div className="p-4">
        <div className="flex items-start gap-3">
          <AppIcon serial={deviceSerial} packageName={pkg.packageName} customPath={customPath} eager />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-bold text-[var(--text-base)]">{name}</h3>
            <p className="truncate text-[9px] text-[var(--text-subtle)]" title={pkg.packageName}>{pkg.packageName}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={pkg.system ? 'warning' : 'primary'}>{pkg.system ? 'System App' : 'User App'}</Badge>
              <Badge tone={pkg.running ? 'success' : 'neutral'}>{pkg.running ? 'Running' : pkg.enabled ? 'Idle' : 'Disabled'}</Badge>
            </div>
          </div>
        </div>

        <section className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-label="Package details">
          {loading ? <InspectorSkeleton /> : (
            <dl className="space-y-2.5 text-[10px]">
              <Detail label="Version" value={info?.versionName} />
              <Detail label="Version Code" value={info?.versionCode} />
              <Detail label="Installed" value={info?.firstInstallTime} />
              <Detail label="Updated" value={info?.lastUpdateTime} />
              <Detail label="APK Size" value={formatPackageBytes(info?.apkSizeBytes)} />
              <Detail label="Data Size" value={formatPackageBytes(info?.dataSizeBytes)} />
              <Detail label="UID" value={info?.uid} />
              <Detail label="Target SDK" value={info?.targetSdk} />
              <Detail label="Min SDK" value={info?.minSdk} />
              <Detail label="Debuggable" value={booleanLabel(info?.debuggable)} />
              <Detail label="Enabled" value={booleanLabel(info?.enabled ?? pkg.enabled)} />
              <Detail label="Install Source" value={info?.installSource} mono />
            </dl>
          )}
        </section>

        <InspectorSection title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton icon={Play} label="Launch App" primary busy={busy('launch')} onClick={() => onAction('launch')} />
            <ActionButton icon={Ban} label="Force Stop" danger busy={busy('force_stop')} onClick={() => onAction('force_stop')} />
            <ActionButton icon={Eraser} label="Trim Cache" busy={busy('clear_cache')} onClick={onClearCache} title="Android exposes cache trimming device-wide without root." />
            <ActionButton icon={Trash2} label="Clear Data" danger busy={busy('clear_data')} onClick={() => onAction('clear_data')} />
          </div>
        </InspectorSection>

        <InspectorSection title="Developer Tools">
          <div className="grid grid-cols-2 gap-2">
            {onOpenLogcat && <ToolButton icon={ScrollText} label="Open Logcat" onClick={onOpenLogcat} />}
            <ToolButton icon={Terminal} label="Shell Context" onClick={onOpenShell} disabled={!onOpenShell || loading} title={onOpenShell ? 'Open a run-as shell draft for this debuggable package.' : 'Package shell context requires a debuggable app.'} />
            <ToolButton icon={Braces} label="Package Info" onClick={onShowPackageInfo} />
            <ToolButton icon={Settings} label="App Settings" onClick={() => onAction('open_settings')} />
            <ToolButton icon={Download} label="Pull APK" onClick={onPullApk} disabled={!onPullApk || loading} busy={pullingApk} title={onPullApk ? 'Save the base APK to a local folder.' : 'The base APK path is unavailable.'} />
            <ToolButton icon={Files} label="Split APKs" onClick={onOpenSplitApks} disabled={loading} title="Discover and selectively extract base and split APKs." />
            <ToolButton icon={ScanSearch} label="Inspect APK" onClick={onOpenApkInspector} title="Choose a local APK for manifest and signature analysis." />
            <ToolButton icon={GitCompareArrows} label="Compare APKs" onClick={onOpenApkCompare} title="Compare an extracted installed APK with a local build, or compare two local APKs." />
            <ToolButton icon={Archive} label="Backup APK Set" onClick={onOpenApkBackup} disabled={loading} title="Export base and split APKs with integrity-checked metadata. App data is excluded." />
            <ToolButton icon={Database} label="Open App Data" disabled title="Direct /data access is unavailable without root or run-as file browsing." />
          </div>
        </InspectorSection>

        <section className="border-t border-[var(--border-subtle)] pt-4">
          <h4 className="mb-2 text-[9px] font-semibold text-red-400">Destructive action</h4>
          <button type="button" onClick={() => onAction('uninstall')} disabled={pkg.system || busy('uninstall')} title={pkg.system ? 'System packages cannot be uninstalled here.' : 'Uninstall this app'} className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-red-500/35 bg-red-500/10 text-[9px] font-semibold text-red-400 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:border-[var(--border-base)] disabled:bg-transparent disabled:text-[var(--text-subtle)] disabled:opacity-60">
            {busy('uninstall') ? <Loader2 size={12} className="animate-spin" /> : <PackageMinus size={12} />}
            {pkg.system ? 'System App — Uninstall unavailable' : 'Uninstall App'}
          </button>
        </section>
      </div>
    </div>
  )
}

function booleanLabel(value?: boolean) {
  return value === undefined ? '—' : value ? 'Yes' : 'No'
}

function Detail({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-[var(--text-subtle)]">{label}</dt><dd className={`min-w-0 truncate text-right text-[var(--text-muted)] ${mono ? 'font-mono text-[9px]' : ''}`} title={value || 'Unavailable'}>{value || '—'}</dd></div>
}

function Badge({ tone, children }: { tone: 'primary' | 'success' | 'warning' | 'neutral'; children: React.ReactNode }) {
  const style = { primary: 'bg-primary/10 text-primary', success: 'bg-emerald-500/10 text-emerald-400', warning: 'bg-amber-500/10 text-amber-400', neutral: 'bg-zinc-500/10 text-zinc-400' }[tone]
  return <span className={`rounded-md px-2 py-0.5 text-[8px] font-semibold ${style}`}>{children}</span>
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4 border-t border-[var(--border-subtle)] pt-4"><h4 className="mb-3 text-[9px] font-semibold text-[var(--text-muted)]">{title}</h4>{children}</section>
}

function ActionButton({ icon: Icon, label, onClick, primary, danger, busy, title }: { icon: typeof Play; label: string; onClick: () => void; primary?: boolean; danger?: boolean; busy: boolean; title?: string }) {
  const style = primary ? 'border-primary bg-primary text-on-primary hover:bg-[var(--primary-hover)]' : danger ? 'border-red-500/25 bg-red-500/10 text-red-400 hover:bg-red-500/15' : 'border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-base)]'
  return <button type="button" onClick={onClick} disabled={busy} title={title} className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-[9px] font-semibold transition disabled:opacity-40 ${style}`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}{label}</button>
}

function ToolButton({ icon: Icon, label, onClick, disabled, busy, title }: { icon: typeof Settings; label: string; onClick?: () => void; disabled?: boolean; busy?: boolean; title?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled || busy} title={title} className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[9px] text-[var(--text-muted)] hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}{label}</button>
}

function InspectorSkeleton() {
  return <div className="space-y-2.5" aria-label="Loading app details"><div className="h-3 w-full animate-pulse rounded bg-white/5" /><div className="h-3 w-5/6 animate-pulse rounded bg-white/5" /><div className="h-3 w-full animate-pulse rounded bg-white/5" /><div className="h-3 w-2/3 animate-pulse rounded bg-white/5" /></div>
}
