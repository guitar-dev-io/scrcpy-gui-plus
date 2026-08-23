import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  AppWindow,
  Ban,
  Boxes,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Loader2,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
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
import { AppGlyph, AppInspector } from './AppInspector'

interface AppManagerProps {
  isOpen: boolean
  embedded?: boolean
  onClose: () => void
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  confirmAction: (title: string, message: string, onConfirm: () => void) => void
  onInstallApk: () => void
  onOpenLogcat?: (packageName: string) => void
  onOpenShell?: (packageName: string) => void
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
  onOpenLogcat,
  onOpenShell,
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
  }, [selectedPackage])

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
        localized && localized !== localizedKey ? localized : result.error || 'Unknown error',
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

  const selected = packages.find((pkg) => pkg.packageName === selectedPackage)
  const selectedInfo = selectedPackage ? infoCache[selectedPackage] : undefined
  const userCount = packages.filter((pkg) => !pkg.system).length
  const systemCount = packages.filter((pkg) => pkg.system).length
  const runningCount = packages.filter((pkg) => pkg.running).length
  const startIndex = visiblePackages.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(page * PAGE_SIZE, visiblePackages.length)

  const panelClassName = embedded
    ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden'
    : 'relative flex max-h-[94vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-base)] p-5 shadow-2xl'

  return (
    <div className={embedded ? 'flex h-full min-h-0 w-full' : 'fixed inset-0 z-[300] flex items-center justify-center p-4'}>
      {!embedded && <button type="button" className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={t('common.close')} />}
      <div role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="app-manager-title" className={panelClassName}>
        <PageHeader activeDevice={activeDevice} loading={loading} embedded={embedded} onInstallApk={onInstallApk} onRefresh={refresh} onClose={onClose} />

        <section className="my-4 grid shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:grid-cols-4" aria-label="App inventory summary">
          <Metric icon={Boxes} label="Installed" value={packages.length} hint="Total packages" tone="primary" />
          <Metric icon={Play} label="Running" value={runningCount} hint="Active processes" tone="success" />
          <Metric icon={AppWindow} label="User Apps" value={userCount} hint="Downloaded by user" tone="info" />
          <Metric icon={Settings} label="System Apps" value={systemCount} hint="Pre-installed system" tone="warning" last />
        </section>

        <div className="flex min-h-0 flex-1 gap-4">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ControlBar
              search={search}
              filter={filter}
              sort={sort}
              showFilters={showFilters}
              runningOnly={runningOnly}
              counts={{ all: packages.length, user: userCount, system: systemCount, running: runningCount }}
              onSearch={setSearch}
              onFilter={changeFilter}
              onSort={setSort}
              onToggleFilters={() => setShowFilters((value) => !value)}
              onToggleRunning={() => setRunningOnly((value) => !value)}
            />

            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" aria-label="Installed applications">
              <TableHeader />
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {!activeDevice ? (
                  <EmptyState icon={ShieldAlert} title="Select a device to manage apps" description="Connect or select an Android device to load its application inventory." />
                ) : loading && packages.length === 0 ? (
                  <ListSkeleton />
                ) : error ? (
                  <EmptyState icon={ShieldAlert} title="Unable to load applications" description="Check the device connection and try again." actionLabel="Retry" onAction={refresh} />
                ) : visiblePackages.length === 0 ? (
                  <EmptyState icon={Search} title="No apps found" description="Try changing your search or filters." actionLabel="Clear filters" onAction={() => { setSearch(''); changeFilter('all'); setRunningOnly(false) }} />
                ) : (
                  pagedPackages.map((pkg) => (
                    <PackageRow
                      key={pkg.packageName}
                      pkg={pkg}
                      info={infoCache[pkg.packageName]}
                      selected={selectedPackage === pkg.packageName}
                      menuOpen={menuPackage === pkg.packageName}
                      launchBusy={Boolean(pending[`${pkg.packageName}::launch`])}
                      onSelect={() => selectPackage(pkg.packageName)}
                      onLaunch={() => handleAction(pkg.packageName, 'launch')}
                      onToggleMenu={() => setMenuPackage((current) => current === pkg.packageName ? null : pkg.packageName)}
                      onAction={(action) => handleAction(pkg.packageName, action)}
                      onPackageInfo={() => { selectPackage(pkg.packageName); setShowPackageInfo(true) }}
                    />
                  ))
                )}
              </div>
              {loading && packages.length > 0 && <div className="pointer-events-none absolute right-3 top-11 flex items-center gap-1.5 rounded-md border border-primary/20 bg-[var(--bg-elevated)] px-2 py-1 text-[9px] text-primary"><Loader2 size={11} className="animate-spin" />Refreshing</div>}
              <Pagination page={page} pageCount={pageCount} start={startIndex} end={endIndex} total={visiblePackages.length} onPage={setPage} />
            </section>
          </main>

          <aside className="hidden min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] xl:flex">
            <AppInspector pkg={selected} info={selectedInfo} loading={selectedPackage ? Boolean(infoLoading[selectedPackage]) : false} busy={(action) => Boolean(pending[`${selectedPackage ?? ''}::${action}`] || (action === 'clear_cache' && pending['::clear_cache']))} onAction={(action) => selectedPackage && handleAction(selectedPackage, action)} onClearCache={handleClearCache} onOpenLogcat={selectedPackage && onOpenLogcat ? () => onOpenLogcat(selectedPackage) : undefined} onOpenShell={selectedPackage && onOpenShell ? () => onOpenShell(selectedPackage) : undefined} onShowPackageInfo={() => setShowPackageInfo(true)} />
          </aside>
        </div>

        {inspectorOpen && (
          <div className="fixed inset-0 z-[320] bg-black/55 xl:hidden" onClick={() => setInspectorOpen(false)}>
            <aside className="absolute inset-y-0 right-0 flex w-[min(90vw,360px)] flex-col overflow-hidden border-l border-[var(--border-base)] bg-[var(--bg-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <AppInspector pkg={selected} info={selectedInfo} loading={selectedPackage ? Boolean(infoLoading[selectedPackage]) : false} busy={(action) => Boolean(pending[`${selectedPackage ?? ''}::${action}`] || (action === 'clear_cache' && pending['::clear_cache']))} onAction={(action) => selectedPackage && handleAction(selectedPackage, action)} onClearCache={handleClearCache} onOpenLogcat={selectedPackage && onOpenLogcat ? () => onOpenLogcat(selectedPackage) : undefined} onOpenShell={selectedPackage && onOpenShell ? () => onOpenShell(selectedPackage) : undefined} onShowPackageInfo={() => setShowPackageInfo(true)} onClose={() => setInspectorOpen(false)} />
            </aside>
          </div>
        )}

        {showPackageInfo && selected && (
          <PackageInfoDialog pkg={selected} info={selectedInfo} loading={Boolean(infoLoading[selected.packageName])} onClose={() => setShowPackageInfo(false)} />
        )}
      </div>
    </div>
  )
}

function PageHeader({ activeDevice, loading, embedded, onInstallApk, onRefresh, onClose }: { activeDevice: string; loading: boolean; embedded: boolean; onInstallApk: () => void; onRefresh: () => void; onClose: () => void }) {
  return <header className="flex min-h-[74px] shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-1 pb-3">
    <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Boxes size={19} /></span><div className="min-w-0"><h1 id="app-manager-title" className="text-lg font-bold tracking-tight text-[var(--text-base)]">App Manager</h1><p className="mt-0.5 truncate text-[10px] text-[var(--text-subtle)]">Inspect, launch, and manage applications on the connected device.</p></div></div>
    <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={onInstallApk} disabled={!activeDevice} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"><Download size={14} />Install APK<ChevronDown size={12} /></button><button type="button" onClick={onRefresh} disabled={loading || !activeDevice} title="Refresh package list" aria-label="Refresh package list" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary disabled:opacity-30"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>{!embedded && <button type="button" onClick={onClose} aria-label="Close App Manager" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] text-[var(--text-muted)] hover:text-white"><X size={15} /></button>}</div>
  </header>
}

function ControlBar({ search, filter, sort, showFilters, runningOnly, counts, onSearch, onFilter, onSort, onToggleFilters, onToggleRunning }: { search: string; filter: PackageFilter; sort: PackageSort; showFilters: boolean; runningOnly: boolean; counts: { all: number; user: number; system: number; running: number }; onSearch: (value: string) => void; onFilter: (filter: PackageFilter) => void; onSort: (sort: PackageSort) => void; onToggleFilters: () => void; onToggleRunning: () => void }) {
  return <section className="shrink-0 space-y-2 pb-3" aria-label="App search and filters"><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[220px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" /><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search apps or package name..." aria-label="Search apps or package name" className="h-9 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] pl-9 pr-3 text-[10px] text-[var(--text-base)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary/60 focus:ring-2 focus:ring-primary/10" /></label><div role="tablist" aria-label="Package type" className="flex h-9 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] p-1">{([['all', `All (${counts.all})`], ['third_party', `User (${counts.user})`], ['system', `System (${counts.system})`]] as [PackageFilter, string][]).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => onFilter(id)} className={`rounded-md px-3 text-[9px] font-semibold transition ${filter === id ? 'bg-primary/15 text-primary ring-1 ring-primary/35' : 'text-[var(--text-muted)] hover:text-[var(--text-base)]'}`}>{label}</button>)}</div><button type="button" aria-expanded={showFilters} onClick={onToggleFilters} className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[9px] font-semibold ${showFilters ? 'border-primary/50 bg-primary/10 text-primary' : 'border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-base)]'}`}><Filter size={13} />Filters</button><select value={sort} onChange={(event) => onSort(event.target.value as PackageSort)} aria-label="Sort applications" className="h-9 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 text-[9px] font-semibold text-[var(--text-muted)] outline-none focus:border-primary"><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option></select></div>{showFilters && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/60 p-2"><span className="px-1 text-[8px] font-bold uppercase tracking-widest text-[var(--text-subtle)]">State</span><FilterChip label={`Running (${counts.running})`} active={runningOnly} onClick={onToggleRunning} tone="success" /><FilterChip label="Disabled" active={filter === 'disabled'} onClick={() => onFilter(filter === 'disabled' ? 'all' : 'disabled')} /><FilterChip label="Debuggable" disabled title="Package-wide debuggable data is not available without inspecting every app." /><FilterChip label="Recently Installed" disabled title="Install dates are fetched lazily for the selected app only." /></div>}</section>
}

function PackageRow({ pkg, info, selected, menuOpen, launchBusy, onSelect, onLaunch, onToggleMenu, onAction, onPackageInfo }: { pkg: PackageEntry; info?: PackageInfoResult; selected: boolean; menuOpen: boolean; launchBusy: boolean; onSelect: () => void; onLaunch: () => void; onToggleMenu: () => void; onAction: (action: AppActionId) => void; onPackageInfo: () => void }) {
  const name = packageDisplayName(pkg.packageName)
  const selectOnKey = (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() } }
  return <article role="button" tabIndex={0} aria-selected={selected} onClick={onSelect} onKeyDown={selectOnKey} className={`relative grid min-h-[64px] cursor-pointer grid-cols-[minmax(220px,1fr)_76px_64px_72px] items-center border-b px-4 outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary xl:grid-cols-[minmax(230px,1fr)_82px_68px_74px_86px_72px] ${selected ? 'border-primary/35 bg-primary/[0.075] shadow-[inset_2px_0_0_var(--primary)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'}`}>
    <div className="flex min-w-0 items-center gap-3"><AppGlyph packageName={pkg.packageName} /><div className="min-w-0"><p className="truncate text-[10px] font-semibold text-[var(--text-base)]">{name}</p><p className="truncate text-[8px] text-[var(--text-subtle)]">{pkg.packageName}</p>{info?.versionName && <p className="truncate text-[8px] text-[var(--text-subtle)]">Version {info.versionName}</p>}</div></div>
    <StatusBadge pkg={pkg} /><TypeBadge system={pkg.system} /><span className="hidden text-[9px] text-[var(--text-muted)] xl:block">{formatPackageBytes(info?.apkSizeBytes)}</span><span className="hidden truncate text-[8px] text-[var(--text-subtle)] xl:block" title={info?.lastUpdateTime}>{info?.lastUpdateTime || '—'}</span>
    <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}><button type="button" onClick={onLaunch} disabled={launchBusy} title={`Launch ${name}`} aria-label={`Launch ${name}`} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-40">{launchBusy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}</button><button type="button" onClick={onToggleMenu} aria-expanded={menuOpen} title={`More actions for ${name}`} aria-label={`More actions for ${name}`} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]"><MoreVertical size={13} /></button>{menuOpen && <RowMenu pkg={pkg} onAction={onAction} onPackageInfo={onPackageInfo} />}</div>
  </article>
}

function RowMenu({ pkg, onAction, onPackageInfo }: { pkg: PackageEntry; onAction: (action: AppActionId) => void; onPackageInfo: () => void }) {
  return <div className="absolute right-3 top-12 z-30 w-44 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-xl" role="menu"><MenuItem icon={Play} label="Launch" onClick={() => onAction('launch')} /><MenuItem icon={Ban} label="Force Stop" onClick={() => onAction('force_stop')} /><MenuItem icon={Settings} label="App Settings" onClick={() => onAction('open_settings')} /><MenuItem icon={AppWindow} label="Package Info" onClick={onPackageInfo} /><div className="my-1 border-t border-[var(--border-subtle)]" /><MenuItem icon={Trash2} label="Clear Data" danger onClick={() => onAction('clear_data')} />{!pkg.system && <MenuItem icon={X} label="Uninstall" danger onClick={() => onAction('uninstall')} />}</div>
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Play; label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[9px] transition ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]'}`}><Icon size={12} />{label}</button>
}

function TableHeader() {
  return <div className="grid h-9 shrink-0 grid-cols-[minmax(220px,1fr)_76px_64px_72px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/45 px-4 text-[8px] font-semibold text-[var(--text-subtle)] xl:grid-cols-[minmax(230px,1fr)_82px_68px_74px_86px_72px]"><span>App / Package</span><span>Status</span><span>Type</span><span className="hidden xl:block">Size</span><span className="hidden xl:block">Updated</span><span className="text-right">Actions</span></div>
}

function Pagination({ page, pageCount, start, end, total, onPage }: { page: number; pageCount: number; start: number; end: number; total: number; onPage: (page: number) => void }) {
  const pages = Array.from(new Set([1, page - 1, page, page + 1, pageCount].filter((value) => value >= 1 && value <= pageCount))).sort((a, b) => a - b)
  return <footer className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 text-[8px] text-[var(--text-subtle)]"><span>Showing {start} to {end} of {total} apps</span><nav className="flex items-center gap-1" aria-label="App list pages"><PageButton label="Previous page" disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={11} /></PageButton>{pages.map((value, index) => <span key={value} className="flex items-center gap-1">{index > 0 && value - pages[index - 1] > 1 && <span className="px-1">…</span>}<PageButton active={value === page} label={`Page ${value}`} onClick={() => onPage(value)}>{value}</PageButton></span>)}<PageButton label="Next page" disabled={page === pageCount} onClick={() => onPage(page + 1)}><ChevronRight size={11} /></PageButton></nav></footer>
}

function PackageInfoDialog({ pkg, info, loading, onClose }: { pkg: PackageEntry; info?: PackageInfoResult; loading: boolean; onClose: () => void }) {
  const fields = info ? Object.entries(info).filter(([key]) => !['success', 'error', 'errorCode'].includes(key)) : []
  return <div className="fixed inset-0 z-[340] flex items-center justify-center bg-black/65 p-4" onClick={onClose}><section role="dialog" aria-modal="true" aria-label={`Package information for ${pkg.packageName}`} onClick={(event) => event.stopPropagation()} className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl"><header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><div><h2 className="text-[12px] font-semibold text-[var(--text-base)]">Package Info</h2><p className="mt-0.5 text-[9px] text-[var(--text-subtle)]">{pkg.packageName}</p></div><button type="button" onClick={onClose} aria-label="Close package info" className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)]"><X size={14} /></button></header><div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">{loading ? <ListSkeleton rows={5} /> : fields.length === 0 ? <p className="py-12 text-center text-[10px] text-[var(--text-subtle)]">Package metadata is unavailable.</p> : <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[9px]">{fields.map(([key, value]) => <div className="contents" key={key}><dt className="text-[var(--text-subtle)]">{key}</dt><dd className="break-all font-mono text-[var(--text-muted)]">{typeof value === 'number' && key.toLowerCase().includes('bytes') ? formatPackageBytes(value) : String(value ?? '—')}</dd></div>)}</dl>}</div></section></div>
}

function Metric({ icon: Icon, label, value, hint, tone, last }: { icon: typeof Boxes; label: string; value: number; hint: string; tone: 'primary' | 'success' | 'info' | 'warning'; last?: boolean }) {
  const style = { primary: 'bg-primary/10 text-primary', success: 'bg-emerald-500/10 text-emerald-400', info: 'bg-sky-500/10 text-sky-400', warning: 'bg-amber-500/10 text-amber-400' }[tone]
  return <div className={`flex items-center gap-3 px-4 py-3 ${last ? '' : 'border-r border-[var(--border-subtle)]'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style}`}><Icon size={14} /></span><div className="min-w-0"><p className="text-[8px] text-[var(--text-subtle)]">{label}</p><p className="text-lg font-bold leading-tight text-[var(--text-base)]">{value}</p><p className="truncate text-[8px] text-[var(--text-subtle)]">{hint}</p></div></div>
}

function StatusBadge({ pkg }: { pkg: PackageEntry }) {
  const style = pkg.running ? 'bg-emerald-500/10 text-emerald-400' : !pkg.enabled ? 'bg-red-500/10 text-red-400' : 'bg-zinc-500/10 text-zinc-400'
  return <span className={`w-fit rounded-md px-2 py-1 text-[8px] font-semibold ${style}`}>{pkg.running ? 'Running' : pkg.enabled ? 'Idle' : 'Disabled'}</span>
}

function TypeBadge({ system }: { system: boolean }) {
  return <span className={`w-fit rounded-md px-2 py-1 text-[8px] font-semibold ${system ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'}`}>{system ? 'System' : 'User'}</span>
}

function FilterChip({ label, active, disabled, onClick, title, tone = 'primary' }: { label: string; active?: boolean; disabled?: boolean; onClick?: () => void; title?: string; tone?: 'primary' | 'success' }) {
  const activeStyle = tone === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-primary/40 bg-primary/10 text-primary'
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={title} className={`rounded-md border px-2.5 py-1 text-[8px] font-semibold ${active ? activeStyle : 'border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]'} disabled:cursor-not-allowed disabled:opacity-35`}>{label}</button>
}

function PageButton({ children, label, active, disabled, onClick }: { children: React.ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick} className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[8px] font-semibold ${active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--border-base)] text-[var(--text-muted)] hover:text-[var(--text-base)]'} disabled:opacity-30`}>{children}</button>
}

function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: { icon: typeof Search; title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-subtle)]"><Icon size={19} /></span><h3 className="mt-3 text-[10px] font-semibold text-[var(--text-muted)]">{title}</h3><p className="mt-1 max-w-sm text-[8px] text-[var(--text-subtle)]">{description}</p>{actionLabel && onAction && <button type="button" onClick={onAction} className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[8px] font-semibold text-primary hover:bg-primary/15">{actionLabel}</button>}</div>
}

function ListSkeleton({ rows = 7 }: { rows?: number }) {
  return <div aria-label="Loading applications">{Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-h-[64px] items-center gap-3 border-b border-[var(--border-subtle)] px-4"><span className="h-10 w-10 animate-pulse rounded-xl bg-white/5" /><div className="flex-1 space-y-2"><div className="h-2.5 w-1/3 animate-pulse rounded bg-white/5" /><div className="h-2 w-1/2 animate-pulse rounded bg-white/5" /></div><span className="h-5 w-16 animate-pulse rounded bg-white/5" /></div>)}</div>
}
