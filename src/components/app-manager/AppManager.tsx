import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AppWindow,
  Ban,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Filter,
  Loader2,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ScrollText,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useAppManager } from '../../hooks/useAppManager'
import type { AppActionId, PackageEntry, PackageFilter, PackageInfoResult } from '../../types/appManager'
import { DESTRUCTIVE_APP_ACTIONS } from '../../types/appManager'
import {
  filterPackages,
  formatPackageBytes,
  packageDisplayName,
  paginatePackages,
  sortPackages,
  type PackageSort,
} from '../../utils/appManagerView'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { compareInputFromExtraction } from '../../services/apkCompareService'
import { discoverPackageApks, extractPackageApks } from '../../services/apkToolkitService'
import type { ApkCompareInput } from '../../types/apkCompare'
import { ApkBackupDialog, ApkCompareDialog, ApkInspectorDialog, SplitApkDialog } from '../apk-toolkit'
import { AppIcon } from './AppIcon'
import { AppInspector } from './AppInspector'

interface AppManagerProps {
  isOpen: boolean
  embedded?: boolean
  onClose: () => void
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  confirmAction: (title: string, message: string, onConfirm: () => void) => void
  onInstallApk: () => void
  onInstallMultiple?: () => void
  onOpenLogcat?: (packageName: string) => void
  onOpenShell?: (packageName: string) => void
  onPullApk?: (packageName: string, remotePath: string) => Promise<void> | void
}

const PAGE_SIZE = 20

export default function AppManager({
  isOpen,
  embedded = false,
  onClose,
  activeDevice,
  customPath,
  notify,
  confirmAction,
  onInstallApk,
  onInstallMultiple,
  onOpenLogcat,
  onOpenShell,
  onPullApk,
}: AppManagerProps) {
  const { t } = useI18n()
  const {
    packages,
    filter,
    search,
    setSearch,
    loading,
    error,
    infoCache,
    infoLoading,
    pending,
    capabilities = { system: true, enabled: true, running: true },
    refresh,
    changeFilter,
    fetchInfo,
    runAction,
  } = useAppManager({ activeDevice, customPath })
  const deferredSearch = useDeferredValue(search)
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)
  const [sort, setSort] = useState<PackageSort>('name-asc')
  const [runningOnly, setRunningOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [menuPackage, setMenuPackage] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [showPackageInfo, setShowPackageInfo] = useState(false)
  const [pullingPackage, setPullingPackage] = useState<string | null>(null)
  const [splitApkPackage, setSplitApkPackage] = useState<string | null>(null)
  const [apkInspectorOpen, setApkInspectorOpen] = useState(false)
  const [apkCompareOpen, setApkCompareOpen] = useState(false)
  const [apkCompareLeft, setApkCompareLeft] = useState<ApkCompareInput>()
  const [preparingCompare, setPreparingCompare] = useState(false)
  const [apkBackupOpen, setApkBackupOpen] = useState(false)

  useEffect(() => {
    if ((isOpen || embedded) && activeDevice) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, embedded, activeDevice])

  const visiblePackages = useMemo(
    () => sortPackages(filterPackages(packages, filter, deferredSearch, runningOnly), sort),
    [packages, filter, deferredSearch, runningOnly, sort],
  )
  const pageCount = Math.max(1, Math.ceil(visiblePackages.length / PAGE_SIZE))
  const pagedPackages = useMemo(
    () => paginatePackages(visiblePackages, page, PAGE_SIZE),
    [visiblePackages, page],
  )

  useEffect(() => {
    setPage(1)
  }, [filter, deferredSearch, runningOnly, sort, activeDevice])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    if (selectedPackage && visiblePackages.some((pkg) => pkg.packageName === selectedPackage)) return
    setSelectedPackage(visiblePackages[0]?.packageName ?? null)
  }, [selectedPackage, visiblePackages])

  useEffect(() => {
    if (selectedPackage) void fetchInfo(selectedPackage)
    // Fetch metadata only when selection changes; the hook caches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPackage, activeDevice])

  useEffect(() => {
    if (!menuPackage) return
    const dismissOnPointer = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest('[data-app-row-actions]')) setMenuPackage(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPackage(null)
    }
    document.addEventListener('pointerdown', dismissOnPointer)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOnPointer)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [menuPackage])

  if (!isOpen && !embedded) return null

  const executeAction = async (packageName: string, action: AppActionId) => {
    const result = await runAction(packageName, action)
    if (result.success) {
      notify(
        t('appManager.actionDoneTitle'),
        t(`appManager.done_${action}`, { pkg: packageName }),
        action === 'uninstall' || action === 'clear_data' ? 'success' : 'info',
      )
      if (action === 'uninstall') setInspectorOpen(false)
    } else if (result.errorCode !== 'busy') {
      const localizedKey = result.errorCode ? `appManager.errors.${result.errorCode}` : ''
      const localized = localizedKey ? t(localizedKey) : ''
      notify(
        t('appManager.actionFailedTitle'),
        localized && localized !== localizedKey ? localized : result.error || t('appManagerUi.unknownError'),
        'error',
      )
    }
  }

  const handleAction = (packageName: string, action: AppActionId) => {
    setMenuPackage(null)
    if (DESTRUCTIVE_APP_ACTIONS.includes(action)) {
      confirmAction(
        t(`appManager.confirm_${action}_title`),
        t(`appManager.confirm_${action}_message`, { pkg: packageName }),
        () => void executeAction(packageName, action),
      )
      return
    }
    void executeAction(packageName, action)
  }

  const handleClearCache = () =>
    confirmAction(
      t('appManager.confirm_clear_cache_title'),
      t('appManager.confirm_clear_cache_message'),
      () => void executeAction('', 'clear_cache'),
    )

  const selectPackage = (packageName: string) => {
    setSelectedPackage(packageName)
    setInspectorOpen(true)
    setMenuPackage(null)
  }

  const toggleRowMenu = (packageName: string) => {
    setSelectedPackage(packageName)
    setMenuPackage((current) => current === packageName ? null : packageName)
  }

  const handlePullApk = async (packageName: string, remotePath: string) => {
    if (!onPullApk || pullingPackage) return
    setPullingPackage(packageName)
    try {
      await onPullApk(packageName, remotePath)
    } finally {
      setPullingPackage(null)
    }
  }

  const prepareInstalledApkCompare = async () => {
    if (!selectedPackage || preparingCompare) return
    const outputDirectory = await open({ directory: true, multiple: false, title: t('appManagerUi.extractForCompare', { pkg: selectedPackage }) })
    if (typeof outputDirectory !== 'string') return
    setPreparingCompare(true)
    try {
      const discovery = await discoverPackageApks(activeDevice, selectedPackage, customPath)
      if (!discovery.success || discovery.files.length === 0) throw new Error(discovery.error || t('appManagerUi.noApkDiscovered'))
      const extraction = await extractPackageApks({
        serial: activeDevice,
        packageName: selectedPackage,
        remotePaths: discovery.files.map((file) => file.path),
        outputDirectory,
        customPath,
        mode: 'folder',
      })
      const input = compareInputFromExtraction(extraction)
      if (!input) throw new Error(extraction.error || t('appManagerUi.baseNotExtracted'))
      setApkCompareLeft(input)
      setApkCompareOpen(true)
      notify(t('appManagerUi.installedApkReadyTitle'), t('appManagerUi.installedApkReadyMessage'), 'success')
    } catch (reason) {
      notify(t('appManagerUi.prepareCompareFailed'), reason instanceof Error ? reason.message : String(reason), 'error')
    } finally {
      setPreparingCompare(false)
    }
  }

  const selected = packages.find((pkg) => pkg.packageName === selectedPackage)
  const selectedInfo = selectedPackage ? infoCache[selectedPackage] : undefined
  const userCount = packages.filter((pkg) => !pkg.system).length
  const systemCount = packages.filter((pkg) => pkg.system).length
  const runningCount = packages.filter((pkg) => pkg.running).length
  const statsAvailable = Boolean(activeDevice) && !error && (!loading || packages.length > 0)
  const startIndex = visiblePackages.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(page * PAGE_SIZE, visiblePackages.length)

  const panelClassName = embedded
    ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden'
    : 'relative flex max-h-[94vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-base)] p-5 shadow-2xl'

  return (
    <div className={embedded ? 'flex h-full min-h-0 w-full' : 'fixed inset-0 z-[300] flex items-center justify-center p-4'}>
      {!embedded && <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={t('common.close')} />}
      <div role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="app-manager-title" className={panelClassName}>
        <PageHeader activeDevice={activeDevice} loading={loading} embedded={embedded} onInstallApk={onInstallApk} onInstallMultiple={onInstallMultiple} onRefresh={refresh} onClose={onClose} />

        {activeDevice ? <section className="my-4 grid shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:grid-cols-4" aria-label={t('appManager.inventorySummary')}>
          <Metric icon={Boxes} label={t('appManagerUi.metricInstalled')} value={statsAvailable ? packages.length : '—'} hint={t('appManagerUi.metricInstalledHint')} tone="primary" />
          <Metric icon={Play} label={t('appManagerUi.metricRunning')} value={statsAvailable && capabilities.running ? runningCount : '—'} hint={t('appManagerUi.metricRunningHint')} tone="success" />
          <Metric icon={AppWindow} label={t('appManagerUi.metricUserApps')} value={statsAvailable && capabilities.system ? userCount : '—'} hint={t('appManagerUi.metricUserHint')} tone="info" />
          <Metric icon={Settings} label={t('appManagerUi.metricSystemApps')} value={statsAvailable && capabilities.system ? systemCount : '—'} hint={t('appManagerUi.metricSystemHint')} tone="warning" last />
        </section> : <div className="h-4 shrink-0" />}

        <div className="flex min-h-0 flex-1 gap-4">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ControlBar
              search={search}
              filter={filter}
              sort={sort}
              showFilters={showFilters}
              runningOnly={runningOnly}
              counts={{ all: packages.length, user: userCount, system: systemCount, running: runningCount }}
              capabilities={capabilities}
              onSearch={setSearch}
              onFilter={changeFilter}
              onSort={setSort}
              onToggleFilters={() => setShowFilters((value) => !value)}
              onToggleRunning={() => setRunningOnly((value) => !value)}
            />

            <section role="grid" className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" aria-label={t('appManagerUi.installedApplicationsAria')}>
              <TableHeader />
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {!activeDevice ? (
                  <EmptyState icon={ShieldAlert} title={t('appManager.noDevice')} description={t('appManagerUi.selectDeviceDesc')} />
                ) : loading && packages.length === 0 ? (
                  <ListSkeleton />
                ) : error ? (
                  <EmptyState icon={ShieldAlert} title={t('appManagerUi.loadFailedTitle')} description={t('appManagerUi.loadFailedDesc')} actionLabel={t('appManagerUi.retry')} onAction={refresh} />
                ) : visiblePackages.length === 0 ? (
                  <EmptyState icon={Search} title={t('appManagerUi.noAppsTitle')} description={t('appManagerUi.noAppsDesc')} actionLabel={t('appManagerUi.clearFilters')} onAction={() => { setSearch(''); changeFilter('all'); setRunningOnly(false) }} />
                ) : (
                  pagedPackages.map((pkg, rowIndex) => (
                    <PackageRow
                      key={pkg.packageName}
                      pkg={pkg}
                      deviceSerial={activeDevice}
                      customPath={customPath}
                      info={infoCache[pkg.packageName]}
                      selected={selectedPackage === pkg.packageName}
                      menuOpen={menuPackage === pkg.packageName}
                      launchBusy={Boolean(pending[`${pkg.packageName}::launch`])}
                      onSelect={() => selectPackage(pkg.packageName)}
                      onLaunch={() => handleAction(pkg.packageName, 'launch')}
                      onToggleMenu={() => toggleRowMenu(pkg.packageName)}
                      onAction={(action) => handleAction(pkg.packageName, action)}
                      onPackageInfo={() => { selectPackage(pkg.packageName); setShowPackageInfo(true) }}
                      onClearCache={handleClearCache}
                      onOpenLogcat={onOpenLogcat ? () => onOpenLogcat(pkg.packageName) : undefined}
                      onOpenShell={infoCache[pkg.packageName]?.debuggable && onOpenShell ? () => onOpenShell(pkg.packageName) : undefined}
                      onPullApk={infoCache[pkg.packageName]?.baseCodePath && onPullApk ? () => handlePullApk(pkg.packageName, infoCache[pkg.packageName].baseCodePath!) : undefined}
                      pullingApk={pullingPackage === pkg.packageName}
                      menuAbove={
                        pagedPackages.length > 3 &&
                        rowIndex >= pagedPackages.length - 3
                      }
                    />
                  ))
                )}
              </div>
              {loading && packages.length > 0 && <div className="pointer-events-none absolute right-3 top-11 flex items-center gap-1.5 rounded-md border border-primary/20 bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-primary"><Loader2 size={11} className="animate-spin" />{t('appManagerUi.refreshing')}</div>}
              {visiblePackages.length > 0 && <Pagination page={page} pageCount={pageCount} start={startIndex} end={endIndex} total={visiblePackages.length} onPage={setPage} />}
            </section>
          </main>

          {activeDevice && <aside className="hidden min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] xl:flex">
            <AppInspector deviceSerial={activeDevice} customPath={customPath} pkg={selected} info={selectedInfo} loading={selectedPackage ? Boolean(infoLoading[selectedPackage]) : false} busy={(action) => Boolean(pending[`${selectedPackage ?? ''}::${action}`] || (action === 'clear_cache' && pending['::clear_cache']))} onAction={(action) => selectedPackage && handleAction(selectedPackage, action)} onClearCache={handleClearCache} onOpenLogcat={selectedPackage && onOpenLogcat ? () => onOpenLogcat(selectedPackage) : undefined} onOpenShell={selectedPackage && selectedInfo?.debuggable && onOpenShell ? () => onOpenShell(selectedPackage) : undefined} onPullApk={selectedPackage && selectedInfo?.baseCodePath && onPullApk ? () => handlePullApk(selectedPackage, selectedInfo.baseCodePath!) : undefined} pullingApk={pullingPackage === selectedPackage} onShowPackageInfo={() => setShowPackageInfo(true)} onOpenSplitApks={() => selectedPackage && setSplitApkPackage(selectedPackage)} onOpenApkInspector={() => setApkInspectorOpen(true)} onOpenApkCompare={() => void prepareInstalledApkCompare()} onOpenApkBackup={() => setApkBackupOpen(true)} />
          </aside>}
        </div>

        {inspectorOpen && (
          <div className="fixed inset-0 z-[320] bg-black/55 xl:hidden" onClick={() => setInspectorOpen(false)}>
            <aside className="absolute inset-y-0 right-0 flex w-[min(90vw,360px)] flex-col overflow-hidden border-l border-[var(--border-base)] bg-[var(--bg-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <AppInspector deviceSerial={activeDevice} customPath={customPath} pkg={selected} info={selectedInfo} loading={selectedPackage ? Boolean(infoLoading[selectedPackage]) : false} busy={(action) => Boolean(pending[`${selectedPackage ?? ''}::${action}`] || (action === 'clear_cache' && pending['::clear_cache']))} onAction={(action) => selectedPackage && handleAction(selectedPackage, action)} onClearCache={handleClearCache} onOpenLogcat={selectedPackage && onOpenLogcat ? () => onOpenLogcat(selectedPackage) : undefined} onOpenShell={selectedPackage && selectedInfo?.debuggable && onOpenShell ? () => onOpenShell(selectedPackage) : undefined} onPullApk={selectedPackage && selectedInfo?.baseCodePath && onPullApk ? () => handlePullApk(selectedPackage, selectedInfo.baseCodePath!) : undefined} pullingApk={pullingPackage === selectedPackage} onShowPackageInfo={() => setShowPackageInfo(true)} onOpenSplitApks={() => selectedPackage && setSplitApkPackage(selectedPackage)} onOpenApkInspector={() => setApkInspectorOpen(true)} onOpenApkCompare={() => void prepareInstalledApkCompare()} onOpenApkBackup={() => setApkBackupOpen(true)} onClose={() => setInspectorOpen(false)} />
            </aside>
          </div>
        )}

        {showPackageInfo && selected && (
          <PackageInfoDialog pkg={selected} info={selectedInfo} loading={Boolean(infoLoading[selected.packageName])} onClose={() => setShowPackageInfo(false)} />
        )}
        {splitApkPackage && <SplitApkDialog open serial={activeDevice} packageName={splitApkPackage} customPath={customPath} onClose={() => setSplitApkPackage(null)} />}
        <ApkInspectorDialog open={apkInspectorOpen} onClose={() => setApkInspectorOpen(false)} />
        <ApkCompareDialog open={apkCompareOpen} left={apkCompareLeft} onClose={() => { setApkCompareOpen(false); setApkCompareLeft(undefined) }} />
        {selectedPackage && <ApkBackupDialog open={apkBackupOpen} serial={activeDevice} packageName={selectedPackage} customPath={customPath} onClose={() => setApkBackupOpen(false)} />}
      </div>
    </div>
  )
}

function PageHeader({ activeDevice, loading, embedded, onInstallApk, onInstallMultiple, onRefresh, onClose }: { activeDevice: string; loading: boolean; embedded: boolean; onInstallApk: () => void; onInstallMultiple?: () => void; onRefresh: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const runInstallOption = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
    action()
  }
  return <header className="flex min-h-[74px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-1 pb-3">
    <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Boxes size={19} /></span><div className="min-w-0"><h1 id="app-manager-title" className="text-lg font-bold tracking-tight text-[var(--text-base)]">{t('appManager.title')}</h1><p className="mt-0.5 truncate text-[12px] text-[var(--text-subtle)]">{t('appManagerUi.headerSubtitle')}</p></div></div>
    <div className="flex shrink-0 items-center gap-2"><details className="group relative"><summary className={`flex h-9 list-none items-center gap-2 rounded-lg bg-primary px-4 text-[12px] font-semibold text-on-primary transition hover:bg-[var(--primary-hover)] [&::-webkit-details-marker]:hidden ${!activeDevice ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`} aria-label={t('appManagerUi.installApkOptionsAria')} aria-disabled={!activeDevice} onClick={(event) => { if (!activeDevice) event.preventDefault() }} title={!activeDevice ? t('appManagerUi.selectDeviceDesc') : undefined}><Download size={14} />{t('appManager.installApk')}<ChevronDown size={12} className="transition group-open:rotate-180" /></summary><div className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-xl"><button type="button" onClick={(event) => runInstallOption(event, onInstallApk)} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"><Download size={12} />{t('appManagerUi.installOnDevice')}</button>{onInstallMultiple && <button type="button" onClick={(event) => runInstallOption(event, onInstallMultiple)} className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[11px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary"><Boxes size={12} />{t('appManagerUi.installOnMultiple')}</button>}</div></details><button type="button" onClick={onRefresh} disabled={loading || !activeDevice} title={t('appManagerUi.refreshList')} aria-label={t('appManagerUi.refreshList')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary disabled:opacity-30"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>{!embedded && <button type="button" onClick={onClose} aria-label={t('appManagerUi.closeManager')} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] text-[var(--text-muted)] hover:text-white"><X size={15} /></button>}</div>
  </header>
}

function ControlBar({ search, filter, sort, showFilters, runningOnly, counts, capabilities, onSearch, onFilter, onSort, onToggleFilters, onToggleRunning }: { search: string; filter: PackageFilter; sort: PackageSort; showFilters: boolean; runningOnly: boolean; counts: { all: number; user: number; system: number; running: number }; capabilities: { system: boolean; enabled: boolean; running: boolean }; onSearch: (value: string) => void; onFilter: (filter: PackageFilter) => void; onSort: (sort: PackageSort) => void; onToggleFilters: () => void; onToggleRunning: () => void }) {
  const { t } = useI18n()
  const packageTabs: [PackageFilter, string, boolean][] = [['all', t('appManagerUi.tabAll', { count: counts.all }), false], ['third_party', t('appManagerUi.tabUser', { count: capabilities.system ? counts.user : '—' }), !capabilities.system], ['system', t('appManagerUi.tabSystem', { count: capabilities.system ? counts.system : '—' }), !capabilities.system]]
  return <section className="shrink-0 space-y-2 pb-3" aria-label={t('appManagerUi.filtersAria')}><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[220px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" /><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t('appManagerUi.searchPlaceholder')} aria-label={t('appManagerUi.searchAria')} className="h-9 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] pl-9 pr-3 text-[12px] text-[var(--text-base)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary/60 focus:ring-2 focus:ring-primary/10" /></label><div role="tablist" aria-label={t('appManagerUi.packageTypeAria')} className="flex h-9 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] p-1">{packageTabs.map(([id, label, disabled]) => <button key={id} type="button" role="tab" aria-selected={filter === id} disabled={disabled} onClick={() => onFilter(id)} className={`rounded-md px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${filter === id ? 'bg-primary/15 text-primary ring-1 ring-primary/35' : 'text-[var(--text-muted)] hover:text-[var(--text-base)]'}`}>{label}</button>)}</div><button type="button" aria-expanded={showFilters} onClick={onToggleFilters} className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[11px] font-semibold ${showFilters ? 'border-primary/50 bg-primary/10 text-primary' : 'border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-base)]'}`}><Filter size={13} />{t('appManagerUi.filters')}</button><select value={sort} onChange={(event) => onSort(event.target.value as PackageSort)} aria-label={t('appManagerUi.sortAria')} className="h-9 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 text-[11px] font-semibold text-[var(--text-muted)] outline-none focus:border-primary"><option value="name-asc">{t('appManagerUi.sortNameAsc')}</option><option value="name-desc">{t('appManagerUi.sortNameDesc')}</option></select></div>{showFilters && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-2"><span className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-subtle)]">{t('appManagerUi.stateLabel')}</span><FilterChip label={t('appManagerUi.chipRunning', { count: capabilities.running ? counts.running : '—' })} active={runningOnly} disabled={!capabilities.running} onClick={onToggleRunning} tone="success" title={capabilities.running ? undefined : t('appManagerUi.chipRunningUnavailable')} /><FilterChip label={t('appManagerUi.chipDisabled')} active={filter === 'disabled'} disabled={!capabilities.enabled} onClick={() => onFilter(filter === 'disabled' ? 'all' : 'disabled')} title={capabilities.enabled ? undefined : t('appManagerUi.chipEnabledUnavailable')} /><FilterChip label={t('appManagerUi.chipDebuggable')} disabled title={t('appManagerUi.chipDebuggableHint')} /><FilterChip label={t('appManagerUi.chipRecent')} disabled title={t('appManagerUi.chipRecentHint')} /></div>}</section>
}

function PackageRow({ pkg, deviceSerial, customPath, info, selected, menuOpen, launchBusy, onSelect, onLaunch, onToggleMenu, onAction, onPackageInfo, onClearCache, onOpenLogcat, onOpenShell, onPullApk, pullingApk, menuAbove }: { pkg: PackageEntry; deviceSerial: string; customPath?: string; info?: PackageInfoResult; selected: boolean; menuOpen: boolean; launchBusy: boolean; onSelect: () => void; onLaunch: () => void; onToggleMenu: () => void; onAction: (action: AppActionId) => void; onPackageInfo: () => void; onClearCache: () => void; onOpenLogcat?: () => void; onOpenShell?: () => void; onPullApk?: () => void; pullingApk: boolean; menuAbove: boolean }) {
  const { t } = useI18n()
  const name = packageDisplayName(pkg.packageName)
  const selectOnKey = (event: React.KeyboardEvent<HTMLElement>) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect() } }
  return <article role="row" tabIndex={0} aria-selected={selected} aria-label={`${name} ${pkg.packageName}`} onClick={onSelect} onKeyDown={selectOnKey} className={`relative grid min-h-[64px] cursor-pointer grid-cols-[minmax(200px,1fr)_88px_72px_80px] items-center border-b px-4 outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary xl:grid-cols-[minmax(230px,1fr)_88px_72px_80px_112px_80px] ${selected ? 'border-primary/35 bg-primary/[0.075] shadow-[inset_2px_0_0_var(--primary)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'}`}>
    <div role="gridcell" className="flex min-w-0 items-center gap-3"><AppIcon serial={deviceSerial} packageName={pkg.packageName} customPath={customPath} eager={selected} /><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-[var(--text-base)]">{name}</p><p className="truncate text-[10px] text-[var(--text-subtle)]">{pkg.packageName}</p>{info?.versionName && <p className="truncate text-[10px] text-[var(--text-subtle)]">{t('appManagerUi.version', { version: info.versionName })}</p>}</div></div>
    <StatusBadge pkg={pkg} /><TypeBadge system={pkg.system} /><span className="hidden text-[11px] text-[var(--text-muted)] xl:block">{formatPackageBytes(info?.apkSizeBytes)}</span><span className="hidden truncate text-[10px] text-[var(--text-subtle)] xl:block" title={info?.lastUpdateTime}>{info?.lastUpdateTime || '—'}</span>
    <div role="gridcell" data-app-row-actions className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}><button type="button" onClick={onLaunch} disabled={launchBusy} title={t('appManagerUi.launchNamed', { name })} aria-label={t('appManagerUi.launchNamed', { name })} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-40">{launchBusy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}</button><button type="button" onClick={onToggleMenu} aria-expanded={menuOpen} aria-haspopup="menu" title={t('appManagerUi.moreActionsFor', { name })} aria-label={t('appManagerUi.moreActionsFor', { name })} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]"><MoreVertical size={13} /></button>{menuOpen && <RowMenu pkg={pkg} onAction={onAction} onPackageInfo={onPackageInfo} onClearCache={onClearCache} onOpenLogcat={onOpenLogcat} onOpenShell={onOpenShell} onPullApk={onPullApk} pullingApk={pullingApk} above={menuAbove} />}</div>
  </article>
}

function RowMenu({ pkg, onAction, onPackageInfo, onClearCache, onOpenLogcat, onOpenShell, onPullApk, pullingApk, above }: { pkg: PackageEntry; onAction: (action: AppActionId) => void; onPackageInfo: () => void; onClearCache: () => void; onOpenLogcat?: () => void; onOpenShell?: () => void; onPullApk?: () => void; pullingApk: boolean; above: boolean }) {
  const { t } = useI18n()
  return <div className={`absolute right-3 z-30 w-48 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-xl ${above ? 'bottom-12' : 'top-12'}`} role="menu" aria-label={t('appManagerUi.menuAria', { pkg: pkg.packageName })}><MenuItem icon={Play} label={t('appManagerUi.launch')} onClick={() => onAction('launch')} /><MenuItem icon={Ban} label={t('appManagerUi.forceStop')} onClick={() => onAction('force_stop')} /><MenuItem icon={Eraser} label={t('appManagerUi.trimDeviceCache')} onClick={onClearCache} /><MenuItem icon={Settings} label={t('appManagerUi.appSettings')} onClick={() => onAction('open_settings')} /><MenuItem icon={AppWindow} label={t('appManagerUi.packageInfo')} onClick={onPackageInfo} /><div className="my-1 border-t border-[var(--border-subtle)]" />{onOpenLogcat && <MenuItem icon={ScrollText} label={t('appManagerUi.openLogcat')} onClick={onOpenLogcat} />}<MenuItem icon={Terminal} label={t('appManagerUi.shellContext')} onClick={() => onOpenShell?.()} disabled={!onOpenShell} title={onOpenShell ? t('appManagerUi.shellMenuHint') : t('appManagerUi.shellRequiresDebuggable')} /><MenuItem icon={Download} label={pullingApk ? t('appManagerUi.pullingApk') : t('appManagerUi.pullApk')} onClick={() => onPullApk?.()} disabled={!onPullApk || pullingApk} title={onPullApk ? t('appManagerUi.pullMenuHint') : t('appManagerUi.pullMenuUnavailable')} /><div className="my-1 border-t border-red-500/20" /><MenuItem icon={Trash2} label={t('appManagerUi.clearData')} danger onClick={() => onAction('clear_data')} />{!pkg.system && <MenuItem icon={X} label={t('appManagerUi.uninstall')} danger onClick={() => onAction('uninstall')} />}</div>
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled, title }: { icon: typeof Play; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; title?: string }) {
  return <button type="button" role="menuitem" onClick={onClick} disabled={disabled} title={title} className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'}`}><Icon size={12} />{label}</button>
}

function TableHeader() {
  const { t } = useI18n()
  return <div role="row" className="grid h-9 shrink-0 grid-cols-[minmax(200px,1fr)_88px_72px_80px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/45 px-4 text-[10px] font-semibold text-[var(--text-subtle)] xl:grid-cols-[minmax(230px,1fr)_88px_72px_80px_112px_80px]"><span role="columnheader">{t('appManagerUi.colApp')}</span><span role="columnheader">{t('appManagerUi.colStatus')}</span><span role="columnheader">{t('appManagerUi.colType')}</span><span role="columnheader" className="hidden xl:block">{t('appManagerUi.colSize')}</span><span role="columnheader" className="hidden xl:block">{t('appManagerUi.colUpdated')}</span><span role="columnheader" className="text-right">{t('appManagerUi.colActions')}</span></div>
}

function Pagination({ page, pageCount, start, end, total, onPage }: { page: number; pageCount: number; start: number; end: number; total: number; onPage: (page: number) => void }) {
  const { t } = useI18n()
  const pages = Array.from(new Set([1, page - 1, page, page + 1, pageCount].filter((value) => value >= 1 && value <= pageCount))).sort((a, b) => a - b)
  return <footer className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 text-[10px] text-[var(--text-subtle)]"><span>{t('appManagerUi.showingRange', { start, end, total })}</span><nav className="flex items-center gap-1" aria-label={t('appManagerUi.pagesAria')}><PageButton label={t('appManagerUi.prevPage')} disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={11} /></PageButton>{pages.map((value, index) => <span key={value} className="flex items-center gap-1">{index > 0 && value - pages[index - 1] > 1 && <span className="px-1">…</span>}<PageButton active={value === page} label={t('appManagerUi.pageN', { page: value })} onClick={() => onPage(value)}>{value}</PageButton></span>)}<PageButton label={t('appManagerUi.nextPage')} disabled={page === pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={11} /></PageButton></nav></footer>
}

function PackageInfoDialog({ pkg, info, loading, onClose }: { pkg: PackageEntry; info?: PackageInfoResult; loading: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const fields = info ? Object.entries(info).filter(([key]) => !['success', 'error', 'errorCode'].includes(key)) : []
  return <div className="fixed inset-0 z-[340] flex items-center justify-center bg-black/65 p-4" onClick={onClose}><section role="dialog" aria-modal="true" aria-label={t('appManagerUi.infoDialogAria', { pkg: pkg.packageName })} onClick={(event) => event.stopPropagation()} className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl"><header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div><h2 className="text-[14px] font-semibold text-[var(--text-base)]">{t('appManagerUi.packageInfo')}</h2><p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">{pkg.packageName}</p></div><button type="button" onClick={onClose} aria-label={t('appManagerUi.closeInfo')} className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)]"><X size={14} /></button></header><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">{loading ? <ListSkeleton rows={5} /> : fields.length === 0 ? <p className="py-12 text-center text-[12px] text-[var(--text-subtle)]">{t('appManagerUi.metadataUnavailable')}</p> : <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px]">{fields.map(([key, value]) => <div className="contents" key={key}><dt className="text-[var(--text-subtle)]">{key}</dt><dd className="break-all font-mono text-[var(--text-muted)]">{typeof value === 'number' && key.toLowerCase().includes('bytes') ? formatPackageBytes(value) : String(value ?? '—')}</dd></div>)}</dl>}</div></section></div>
}

function Metric({ icon: Icon, label, value, hint, tone, last }: { icon: typeof Boxes; label: string; value: number | string; hint: string; tone: 'primary' | 'success' | 'info' | 'warning'; last?: boolean }) {
  const style = { primary: 'bg-primary/10 text-primary', success: 'bg-emerald-500/10 text-emerald-400', info: 'bg-sky-500/10 text-sky-400', warning: 'bg-amber-500/10 text-amber-400' }[tone]
  return <div className={`flex items-center gap-3 px-4 py-3 ${last ? '' : 'border-r border-[var(--border-subtle)]'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style}`}><Icon size={14} /></span><div className="min-w-0"><p className="text-[10px] text-[var(--text-subtle)]">{label}</p><p className="text-lg font-bold leading-tight text-[var(--text-base)]">{value}</p><p className="truncate text-[10px] text-[var(--text-subtle)]">{hint}</p></div></div>
}

function StatusBadge({ pkg }: { pkg: PackageEntry }) {
  const { t } = useI18n()
  const style = pkg.running ? 'bg-emerald-500/10 text-emerald-400' : !pkg.enabled ? 'bg-red-500/10 text-red-400' : 'bg-zinc-500/10 text-zinc-400'
  return <span className={`w-fit rounded-md px-2 py-1 text-[10px] font-semibold ${style}`}>{pkg.running ? t('appManagerUi.statusRunning') : pkg.enabled ? t('appManagerUi.statusIdle') : t('appManagerUi.statusDisabled')}</span>
}

function TypeBadge({ system }: { system: boolean }) {
  const { t } = useI18n()
  return <span className={`w-fit rounded-md px-2 py-1 text-[10px] font-semibold ${system ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'}`}>{system ? t('appManagerUi.typeSystem') : t('appManagerUi.typeUser')}</span>
}

function FilterChip({ label, active, disabled, onClick, title, tone = 'primary' }: { label: string; active?: boolean; disabled?: boolean; onClick?: () => void; title?: string; tone?: 'primary' | 'success' }) {
  const activeStyle = tone === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-primary/40 bg-primary/10 text-primary'
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={title} className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold ${active ? activeStyle : 'border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]'} disabled:cursor-not-allowed disabled:opacity-35`}>{label}</button>
}

function PageButton({ children, label, active, disabled, onClick }: { children: React.ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick} className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]'} disabled:opacity-30`}>{children}</button>
}

function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: { icon: typeof Search; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-subtle)]"><Icon size={19} /></span><h3 className="mt-3 text-[12px] font-semibold text-[var(--text-muted)]">{title}</h3><p className="mt-1 max-w-sm text-[10px] text-[var(--text-subtle)]">{description}</p>{actionLabel && onAction && <button type="button" onClick={onAction} className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/15">{actionLabel}</button>}</div>
}

function ListSkeleton({ rows = 7 }: { rows?: number }) {
  const { t } = useI18n()
  return <div aria-label={t('appManagerUi.loadingAppsAria')}>{Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-h-[64px] items-center gap-3 border-b border-[var(--border-subtle)] px-4"><span className="h-10 w-10 animate-pulse rounded-xl bg-white/5" /><div className="flex-1 space-y-2"><div className="h-2.5 w-1/3 animate-pulse rounded bg-white/5" /><div className="h-2 w-1/2 animate-pulse rounded bg-white/5" /></div><span className="h-5 w-16 animate-pulse rounded bg-white/5" /></div>)}</div>
}
