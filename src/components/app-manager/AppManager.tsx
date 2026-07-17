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
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    notify: ToolbarNotifier;
    /** Confirms a destructive action before it runs. */
    confirmAction: (title: string, message: string, onConfirm: () => void) => void;
    /** Opens the file picker and installs an APK on the active device. */
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

    // Load the package list when the modal opens for an active device.
    useEffect(() => {
        if (isOpen && activeDevice) {
            void refresh();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activeDevice]);

    if (!isOpen) return null;

    const executeAction = async (packageName: string, action: AppActionId) => {
        const res = await runAction(packageName, action);
        if (res.success) {
            notify(
                t('appManager.actionDoneTitle'),
                t(`appManager.done_${action}`, { pkg: packageName }),
                action === 'uninstall' || action === 'clear_data' ? 'success' : 'info'
            );
        } else if (res.errorCode !== 'busy') {
            const localizedKey = res.errorCode ? `appManager.errors.${res.errorCode}` : '';
            const localized = localizedKey ? t(localizedKey) : '';
            const message =
                localized && localized !== localizedKey
                    ? localized
                    : res.error || 'Unknown error';
            notify(t('appManager.actionFailedTitle'), message, 'error');
        }
    };

    const handleAction = (packageName: string, action: AppActionId) => {
        if (DESTRUCTIVE_APP_ACTIONS.includes(action)) {
            confirmAction(
                t(`appManager.confirm_${action}_title`),
                t(`appManager.confirm_${action}_message`, { pkg: packageName }),
                () => void executeAction(packageName, action)
            );
        } else {
            void executeAction(packageName, action);
        }
    };

    const handleClearCache = () => {
        confirmAction(
            t('appManager.confirm_clear_cache_title'),
            t('appManager.confirm_clear_cache_message'),
            () => void executeAction('', 'clear_cache')
        );
    };

    const isBusy = (packageName: string, action: AppActionId) =>
        !!pending[`${packageName}::${action}`];

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-2xl max-h-[88vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Boxes size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('appManager.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('appManager.noDevice')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => void refresh()}
                            disabled={loading || !activeDevice}
                            title={t('common.refresh')}
                            className="p-2 rounded-xl text-zinc-500 hover:text-primary hover:bg-white/5 transition-all disabled:opacity-30"
                        >
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Toolbar: filters + search + install */}
                <div className="px-6 py-3 border-b border-zinc-800/60 space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="bg-black/40 p-1 rounded-lg flex gap-1 border border-zinc-800/50">
                            {FILTER_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => changeFilter(tab.id)}
                                    disabled={loading}
                                    className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                                        filter === tab.id
                                            ? 'bg-primary text-on-primary shadow-lg'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    {t(tab.labelKey)}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={onInstallApk}
                            disabled={!activeDevice}
                            title={t('appManager.installApk')}
                            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30"
                        >
                            <PackagePlus size={13} /> {t('appManager.installApk')}
                        </button>
                        <button
                            onClick={handleClearCache}
                            disabled={!activeDevice || isBusy('', 'clear_cache')}
                            title={t('appManager.clearCacheTooltip')}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30"
                        >
                            {isBusy('', 'clear_cache') ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <Eraser size={13} />
                            )}
                            {t('appManager.actionClearCache')}
                        </button>
                    </div>

                    <div className="relative">
                        <Search
                            size={13}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('appManager.searchPlaceholder')}
                            className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Package list */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    {!activeDevice ? (
                        <EmptyState icon={ShieldAlert} label={t('appManager.noDevice')} />
                    ) : loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                            <Loader2 size={22} className="animate-spin" />
                            <span className="text-[10px] uppercase tracking-widest mt-2">
                                {t('appManager.loading')}
                            </span>
                        </div>
                    ) : error ? (
                        <EmptyState
                            icon={ShieldAlert}
                            label={
                                error === 'no_device'
                                    ? t('appManager.noDevice')
                                    : t(`appManager.errors.${error}`) !==
                                        `appManager.errors.${error}`
                                      ? t(`appManager.errors.${error}`)
                                      : error
                            }
                        />
                    ) : filtered.length === 0 ? (
                        <EmptyState
                            icon={PackageSearch}
                            label={
                                packages.length === 0
                                    ? t('appManager.noPackages')
                                    : t('appManager.noMatches')
                            }
                        />
                    ) : (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between px-1 pb-1">
                                <span className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">
                                    {t('appManager.packageCount', { count: filtered.length })}
                                </span>
                            </div>
                            {filtered.map((pkg) => {
                                const info = infoCache[pkg.packageName];
                                const loadingInfo = infoLoading[pkg.packageName];
                                return (
                                    <div
                                        key={pkg.packageName}
                                        className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700 transition-colors overflow-hidden"
                                    >
                                        <div className="flex items-center gap-2 p-2.5">
                                            <button
                                                onClick={() => fetchInfo(pkg.packageName)}
                                                title={t('appManager.showInfo')}
                                                className="shrink-0 p-1 rounded text-zinc-600 hover:text-primary transition-colors"
                                            >
                                                <ChevronDown size={13} />
                                            </button>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[11px] font-bold text-zinc-200 truncate font-mono">
                                                    {pkg.packageName}
                                                </p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {pkg.system ? (
                                                        <span className="text-[7px] font-black uppercase tracking-tighter text-amber-500/80 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20">
                                                            {t('appManager.badgeSystem')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[7px] font-black uppercase tracking-tighter text-emerald-500/80 bg-emerald-500/10 px-1 py-0.5 rounded border border-emerald-500/20">
                                                            {t('appManager.badgeUser')}
                                                        </span>
                                                    )}
                                                    {loadingInfo && (
                                                        <Loader2
                                                            size={9}
                                                            className="animate-spin text-zinc-600"
                                                        />
                                                    )}
                                                    {info?.success && (
                                                        <span className="text-[8px] text-zinc-500 truncate">
                                                            {t('appManager.versionLabel', {
                                                                name: info.versionName || '?',
                                                                code: info.versionCode || '?'
                                                            })}
                                                        </span>
                                                    )}
                                                    {info && !info.success && (
                                                        <span className="text-[8px] text-red-400/70 truncate">
                                                            {t('appManager.infoUnavailable')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-0.5 shrink-0">
                                                {ROW_ACTIONS.map((a) => {
                                                    const busy = isBusy(pkg.packageName, a.id);
                                                    return (
                                                        <button
                                                            key={a.id}
                                                            onClick={() =>
                                                                handleAction(pkg.packageName, a.id)
                                                            }
                                                            disabled={busy}
                                                            title={t(a.labelKey)}
                                                            aria-label={t(a.labelKey)}
                                                            className={`p-1.5 rounded-md transition-colors disabled:opacity-40 ${
                                                                a.danger
                                                                    ? 'text-zinc-500 hover:text-red-400 hover:bg-red-500/10'
                                                                    : 'text-zinc-500 hover:text-primary hover:bg-primary/10'
                                                            }`}
                                                        >
                                                            {busy ? (
                                                                <Loader2
                                                                    size={13}
                                                                    className="animate-spin"
                                                                />
                                                            ) : (
                                                                <a.icon size={13} />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function EmptyState({
    icon: Icon,
    label
}: {
    icon: typeof PackageSearch;
    label: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-700">
            <Icon size={24} />
            <span className="text-[10px] uppercase tracking-widest mt-2 text-center px-6">
                {label}
            </span>
        </div>
    );
}
