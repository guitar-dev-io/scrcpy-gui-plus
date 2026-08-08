import { useEffect } from 'react';
import {
    X,
    Boxes,
    RefreshCw,
    Search,
    Play,
    RotateCcw,
    Ban,
    Trash2,
    Eraser,
    Settings,
    PackageMinus,
    PackagePlus,
    Loader2,
    ChevronDown,
    PackageSearch,
    ShieldAlert
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppManager } from '../../hooks/useAppManager';
import type { AppActionId, PackageFilter } from '../../types/appManager';
import { DESTRUCTIVE_APP_ACTIONS } from '../../types/appManager';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface AppManagerProps {
    isOpen: boolean;
    embedded?: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    notify: ToolbarNotifier;
    confirmAction: (title: string, message: string, onConfirm: () => void) => void;
    onInstallApk: () => void;
}

const FILTER_TABS: { id: PackageFilter; labelKey: string }[] = [
    { id: 'third_party', labelKey: 'appManager.filterUser' },
    { id: 'system', labelKey: 'appManager.filterSystem' },
    { id: 'all', labelKey: 'appManager.filterAll' }
];

const ROW_ACTIONS: { id: AppActionId; icon: typeof Play; labelKey: string; danger?: boolean }[] = [
    { id: 'launch', icon: Play, labelKey: 'appManager.actionLaunch' },
    { id: 'restart', icon: RotateCcw, labelKey: 'appManager.actionRestart' },
    { id: 'force_stop', icon: Ban, labelKey: 'appManager.actionForceStop' },
    { id: 'clear_data', icon: Trash2, labelKey: 'appManager.actionClearData', danger: true },
    { id: 'open_settings', icon: Settings, labelKey: 'appManager.actionOpenSettings' },
    { id: 'uninstall', icon: PackageMinus, labelKey: 'appManager.actionUninstall', danger: true }
];

export default function AppManager({
    isOpen,
    embedded = false,
    onClose,
    activeDevice,
    customPath,
    notify,
    confirmAction,
    onInstallApk
}: AppManagerProps) {
    const { t } = useI18n();
    const {
        filtered,
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
        runAction
    } = useAppManager({ activeDevice, customPath });

    useEffect(() => {
        if (isOpen && activeDevice) void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activeDevice]);

    if (!isOpen && !embedded) return null;

    const executeAction = async (packageName: string, action: AppActionId) => {
        const res = await runAction(packageName, action);
        if (res.success) {
            notify(t('appManager.actionDoneTitle'), t(`appManager.done_${action}`, { pkg: packageName }), action === 'uninstall' || action === 'clear_data' ? 'success' : 'info');
        } else if (res.errorCode !== 'busy') {
            const localizedKey = res.errorCode ? `appManager.errors.${res.errorCode}` : '';
            const localized = localizedKey ? t(localizedKey) : '';
            notify(t('appManager.actionFailedTitle'), localized && localized !== localizedKey ? localized : res.error || 'Unknown error', 'error');
        }
    };

    const handleAction = (packageName: string, action: AppActionId) => {
        if (DESTRUCTIVE_APP_ACTIONS.includes(action)) {
            confirmAction(t(`appManager.confirm_${action}_title`), t(`appManager.confirm_${action}_message`, { pkg: packageName }), () => void executeAction(packageName, action));
        } else void executeAction(packageName, action);
    };

    const handleClearCache = () => confirmAction(t('appManager.confirm_clear_cache_title'), t('appManager.confirm_clear_cache_message'), () => void executeAction('', 'clear_cache'));
    const isBusy = (packageName: string, action: AppActionId) => !!pending[`${packageName}::${action}`];
    const userCount = packages.filter((pkg) => !pkg.system).length;
    const systemCount = packages.filter((pkg) => pkg.system).length;
    const filterKey = filter === 'third_party' ? 'User' : filter === 'system' ? 'System' : 'All';

    const dialogClassName = embedded
        ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl'
        : 'relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200';

    return (
        <div className={embedded ? 'flex h-full min-h-0 w-full' : 'fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6'}>
            {!embedded && <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />}
            <div role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby={embedded ? undefined : 'app-manager-title'} className={dialogClassName}>
                <header className="flex items-start justify-between gap-4 border-b border-zinc-800/70 bg-gradient-to-br from-primary/[0.12] via-transparent to-transparent px-5 py-5 sm:px-7">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-lg shadow-primary/10"><Boxes size={21} /></div>
                        <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-[0.22em] text-primary">{t('appManager.toolLabel')}</p>
                            <h3 id="app-manager-title" className="truncate text-base font-black tracking-tight text-white sm:text-lg">{t('appManager.title')}</h3>
                            <p className="mt-1 truncate text-[10px] text-zinc-500">{t('appManager.subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider sm:flex ${activeDevice ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${activeDevice ? 'bg-emerald-400' : 'bg-zinc-600'}`} />{activeDevice ? t('appManager.deviceReady') : t('appManager.noDevice')}</div>
                        <button onClick={() => void refresh()} disabled={loading || !activeDevice} title={t('common.refresh')} aria-label={t('common.refresh')} className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
                        {!embedded && <button onClick={onClose} aria-label={t('common.close')} className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"><X size={18} /></button>}
                    </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <section className="grid grid-cols-2 gap-2 border-b border-zinc-800/70 p-4 sm:grid-cols-4 sm:px-7" aria-label={t('appManager.inventorySummary')}>
                        <Metric icon={PackageSearch} label={t('appManager.totalApps')} value={packages.length} accent="primary" />
                        <Metric icon={Boxes} label={t('appManager.visibleApps')} value={filtered.length} />
                        <Metric icon={ShieldAlert} label={t('appManager.userApps')} value={userCount} accent="success" />
                        <Metric icon={Settings} label={t('appManager.systemApps')} value={systemCount} accent="warning" />
                    </section>

                    <section className="space-y-3 border-b border-zinc-800/70 bg-zinc-950/40 px-4 py-4 sm:px-7">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex rounded-xl border border-zinc-800 bg-black/30 p-1" role="tablist" aria-label={t('appManager.filterLabel')}>
                                {FILTER_TABS.map((tab) => <button key={tab.id} onClick={() => changeFilter(tab.id)} disabled={loading} aria-pressed={filter === tab.id} className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${filter === tab.id ? 'bg-primary text-on-primary shadow-lg' : 'text-zinc-500 hover:text-zinc-300'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}>{t(tab.labelKey)}</button>)}
                            </div>
                            <div className="ml-auto flex flex-wrap gap-2">
                                <button onClick={onInstallApk} disabled={!activeDevice} className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><PackagePlus size={13} /> {t('appManager.installApk')}</button>
                                <button onClick={handleClearCache} disabled={!activeDevice || isBusy('', 'clear_cache')} title={t('appManager.clearCacheTooltip')} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30">{isBusy('', 'clear_cache') ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />}{t('appManager.actionClearCache')}</button>
                            </div>
                        </div>
                        <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('appManager.searchPlaceholder')} aria-label={t('appManager.searchPlaceholder')} className="w-full rounded-xl border border-zinc-800 bg-black/30 py-2.5 pl-9 pr-3 text-[11px] text-zinc-200 transition-all placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10" /></div>
                    </section>

                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-7">
                        {!activeDevice ? <EmptyState icon={ShieldAlert} label={t('appManager.noDevice')} hint={t('appManager.noDeviceHint')} />
                            : loading ? <LoadingState label={t('appManager.loading')} />
                            : error ? <EmptyState icon={ShieldAlert} label={error === 'no_device' ? t('appManager.noDevice') : t(`appManager.errors.${error}`) !== `appManager.errors.${error}` ? t(`appManager.errors.${error}`) : error} />
                            : filtered.length === 0 ? <EmptyState icon={PackageSearch} label={packages.length === 0 ? t('appManager.noPackages') : t('appManager.noMatches')} />
                            : <div className="space-y-2"><div className="flex items-center justify-between px-1 pb-1"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t('appManager.packageInventory')}</p><p className="mt-0.5 text-[9px] text-zinc-600">{t('appManager.packageCount', { count: filtered.length })}</p></div><span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-zinc-500">{t(`appManager.filter${filterKey}`)}</span></div>
                                {filtered.map((pkg) => { const info = infoCache[pkg.packageName]; const loadingInfo = infoLoading[pkg.packageName]; return <article key={pkg.packageName} className="group rounded-2xl border border-zinc-800/80 bg-zinc-900/45 p-3 transition-all hover:border-primary/30 hover:bg-zinc-900/75 sm:p-4"><div className="flex flex-wrap items-center gap-3"><button onClick={() => fetchInfo(pkg.packageName)} title={t('appManager.showInfo')} aria-label={`${t('appManager.showInfo')}: ${pkg.packageName}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-black/30 text-zinc-500 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">{loadingInfo ? <Loader2 size={15} className="animate-spin" /> : <ChevronDown size={15} />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="min-w-0 truncate font-mono text-[11px] font-bold text-zinc-200">{pkg.packageName}</p><span className={`rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${pkg.system ? 'border-amber-500/20 bg-amber-500/10 text-amber-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'}`}>{pkg.system ? t('appManager.badgeSystem') : t('appManager.badgeUser')}</span></div><p className="mt-1 truncate text-[9px] text-zinc-500">{info?.success ? t('appManager.versionLabel', { name: info.versionName || '?', code: info.versionCode || '?' }) : info && !info.success ? t('appManager.infoUnavailable') : t('appManager.tapForDetails')}</p></div><div className="flex w-full items-center justify-end gap-1 border-t border-zinc-800/60 pt-2 sm:w-auto sm:border-0 sm:pt-0" aria-label={t('appManager.toolActions')}>{ROW_ACTIONS.map((a) => { const busy = isBusy(pkg.packageName, a.id); return <button key={a.id} onClick={() => handleAction(pkg.packageName, a.id)} disabled={busy} title={t(a.labelKey)} aria-label={`${t(a.labelKey)}: ${pkg.packageName}`} className={`rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40 ${a.danger ? 'text-zinc-500 hover:bg-red-500/10 hover:text-red-400' : 'text-zinc-500 hover:bg-primary/10 hover:text-primary'}`}>{busy ? <Loader2 size={14} className="animate-spin" /> : <a.icon size={14} />}</button>; })}</div></div></article>; })}
                            </div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Metric({ icon: Icon, label, value, accent = 'neutral' }: { icon: typeof Boxes; label: string; value: number; accent?: 'neutral' | 'primary' | 'success' | 'warning' }) {
    const color = accent === 'success' ? 'text-emerald-400' : accent === 'warning' ? 'text-amber-400' : accent === 'primary' ? 'text-primary' : 'text-zinc-400';
    return <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/35 px-3 py-2.5"><div className="flex items-center gap-1.5"><Icon size={12} className={color} /><span className="truncate text-[8px] font-black uppercase tracking-widest text-zinc-600">{label}</span></div><p className="mt-1 text-lg font-black tracking-tight text-zinc-200">{value}</p></div>;
}

function LoadingState({ label }: { label: string }) {
    return <div className="flex flex-col items-center justify-center py-20 text-zinc-600"><Loader2 size={25} className="animate-spin text-primary" /><span className="mt-3 text-[10px] font-black uppercase tracking-[0.18em]">{label}</span></div>;
}

function EmptyState({ icon: Icon, label, hint }: { icon: typeof PackageSearch; label: string; hint?: string }) {
    return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60"><Icon size={22} /></div><span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>{hint && <span className="mt-1 max-w-sm px-6 text-center text-[10px] text-zinc-600">{hint}</span>}</div>;
}
