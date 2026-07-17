import { useEffect, useMemo, useState } from 'react';
import {
    X,
    Link2,
    Send,
    Star,
    Trash2,
    History,
    QrCode,
    Loader2,
    StarOff
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useDeepLink } from '../../hooks/useDeepLink';
import { listPackages } from '../../services/appManagerService';
import type { PackageEntry } from '../../types/appManager';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface DeepLinkLauncherProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    notify: ToolbarNotifier;
}

export default function DeepLinkLauncher({
    isOpen,
    onClose,
    activeDevice,
    customPath,
    notify
}: DeepLinkLauncherProps) {
    const { t } = useI18n();
    const deepLink = useDeepLink({ activeDevice, customPath });
    const [uri, setUri] = useState('');
    const [packageName, setPackageName] = useState('');
    const [packages, setPackages] = useState<PackageEntry[]>([]);
    const [pkgLoading, setPkgLoading] = useState(false);

    const disabled = !activeDevice;

    // Lazily load the (user) package list for the optional target selector.
    useEffect(() => {
        if (!isOpen || !activeDevice) return;
        let cancelled = false;
        setPkgLoading(true);
        listPackages(activeDevice, 'third_party', customPath)
            .then((res) => {
                if (!cancelled && res.success) setPackages(res.packages);
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setPkgLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, activeDevice, customPath]);

    // Regenerate the QR whenever the URI changes (debounced lightly).
    useEffect(() => {
        if (!isOpen) return;
        const id = setTimeout(() => void deepLink.refreshQr(uri), 250);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uri, isOpen]);

    const sortedPackages = useMemo(
        () => [...packages].sort((a, b) => a.packageName.localeCompare(b.packageName)),
        [packages]
    );

    if (!isOpen) return null;

    const handleLaunch = async () => {
        const res = await deepLink.launch(uri, packageName);
        if (res.success) {
            notify(t('deepLink.launchedTitle'), t('deepLink.launchedMessage', { uri }), 'success');
        } else if (res.errorCode !== 'busy') {
            const key = res.errorCode ? `deepLink.errors.${res.errorCode}` : '';
            const localized = key ? t(key) : '';
            const message =
                localized && localized !== key ? localized : res.error || 'Unknown error';
            notify(t('deepLink.launchFailedTitle'), message, 'error');
        }
    };

    const handleSaveFavorite = () => {
        const trimmed = uri.trim();
        if (!trimmed) return;
        deepLink.addFavorite({
            label: trimmed,
            uri: trimmed,
            packageName: packageName.trim() || undefined
        });
        notify(t('deepLink.savedTitle'), t('deepLink.savedMessage'), 'success');
    };

    const applyEntry = (nextUri: string, nextPkg?: string) => {
        setUri(nextUri);
        setPackageName(nextPkg || '');
    };

    const inputCls =
        'w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[12px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Link2 size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('deepLink.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('deepLink.noDevice')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
                        {/* Left: input + actions */}
                        <div className="space-y-3">
                            <div>
                                <label className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                    {t('deepLink.uriLabel')}
                                </label>
                                <input
                                    className={`${inputCls} mt-1 font-mono`}
                                    placeholder={t('deepLink.uriPlaceholder')}
                                    value={uri}
                                    onChange={(e) => setUri(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                    {t('deepLink.packageLabel')}
                                    {pkgLoading && (
                                        <Loader2
                                            size={9}
                                            className="animate-spin inline ml-1 text-zinc-600"
                                        />
                                    )}
                                </label>
                                <select
                                    className={`${inputCls} mt-1`}
                                    value={packageName}
                                    onChange={(e) => setPackageName(e.target.value)}
                                >
                                    <option value="">{t('deepLink.anyPackage')}</option>
                                    {sortedPackages.map((p) => (
                                        <option key={p.packageName} value={p.packageName}>
                                            {p.packageName}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleLaunch}
                                    disabled={disabled || deepLink.launching || !uri.trim()}
                                    className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                >
                                    {deepLink.launching ? (
                                        <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                        <Send size={13} />
                                    )}
                                    {t('deepLink.launch')}
                                </button>
                                <button
                                    onClick={handleSaveFavorite}
                                    disabled={!uri.trim()}
                                    title={t('deepLink.saveFavorite')}
                                    className="px-3 py-2.5 rounded-xl border border-zinc-800 text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30"
                                >
                                    <Star size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Right: QR */}
                        <div className="flex flex-col items-center justify-start gap-1.5">
                            <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-1">
                                <QrCode size={11} /> {t('deepLink.qrTitle')}
                            </span>
                            <div className="w-[160px] h-[160px] rounded-xl border border-zinc-800 bg-black/60 flex items-center justify-center overflow-hidden p-1.5">
                                {deepLink.qrSvg ? (
                                    <div
                                        className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                                        // SVG is generated by our own trusted Rust backend.
                                        dangerouslySetInnerHTML={{ __html: deepLink.qrSvg }}
                                    />
                                ) : (
                                    <QrCode size={40} className="text-zinc-800" />
                                )}
                            </div>
                            <span className="text-[8px] text-zinc-600 text-center max-w-[160px]">
                                {t('deepLink.qrHint')}
                            </span>
                        </div>
                    </div>

                    {/* Favorites */}
                    <Section
                        icon={Star}
                        title={t('deepLink.favorites')}
                        empty={deepLink.favorites.length === 0}
                        emptyLabel={t('deepLink.noFavorites')}
                    >
                        {deepLink.favorites.map((f) => (
                            <div
                                key={f.id}
                                className="flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700 transition-colors group"
                            >
                                <button
                                    onClick={() => applyEntry(f.uri, f.packageName)}
                                    className="flex-1 min-w-0 text-left"
                                >
                                    <p className="text-[11px] font-mono text-zinc-200 truncate">
                                        {f.uri}
                                    </p>
                                    {f.packageName && (
                                        <p className="text-[8px] text-zinc-500 truncate">
                                            {f.packageName}
                                        </p>
                                    )}
                                </button>
                                <button
                                    onClick={() => deepLink.removeFavorite(f.id)}
                                    title={t('deepLink.removeFavorite')}
                                    className="p-1 rounded text-zinc-600 hover:text-red-400 opacity-60 group-hover:opacity-100 transition-all"
                                >
                                    <StarOff size={12} />
                                </button>
                            </div>
                        ))}
                    </Section>

                    {/* History */}
                    <Section
                        icon={History}
                        title={t('deepLink.history')}
                        empty={deepLink.history.length === 0}
                        emptyLabel={t('deepLink.noHistory')}
                        onClear={
                            deepLink.history.length > 0 ? deepLink.clearHistory : undefined
                        }
                        clearLabel={t('common.clear')}
                    >
                        {deepLink.history.map((h, idx) => (
                            <button
                                key={`${h.uri}-${idx}`}
                                onClick={() => applyEntry(h.uri, h.packageName)}
                                className="w-full flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700 transition-colors text-left"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-mono text-zinc-300 truncate">
                                        {h.uri}
                                    </p>
                                    {h.packageName && (
                                        <p className="text-[8px] text-zinc-500 truncate">
                                            {h.packageName}
                                        </p>
                                    )}
                                </div>
                            </button>
                        ))}
                    </Section>
                </div>
            </div>
        </div>
    );
}

function Section({
    icon: Icon,
    title,
    empty,
    emptyLabel,
    onClear,
    clearLabel,
    children
}: {
    icon: typeof Star;
    title: string;
    empty: boolean;
    emptyLabel: string;
    onClear?: () => void;
    clearLabel?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-1">
                    <Icon size={11} /> {title}
                </span>
                {onClear && (
                    <button
                        onClick={onClear}
                        className="flex items-center gap-1 text-[8px] font-black uppercase text-zinc-600 hover:text-red-400 tracking-widest transition-colors"
                    >
                        <Trash2 size={10} /> {clearLabel}
                    </button>
                )}
            </div>
            {empty ? (
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest py-3 text-center">
                    {emptyLabel}
                </p>
            ) : (
                <div className="space-y-1.5">{children}</div>
            )}
        </div>
    );
}
