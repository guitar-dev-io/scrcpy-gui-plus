import {
    X,
    Gauge,
    Zap,
    Film,
    Cpu,
    AlertTriangle,
    Wifi,
    WifiOff,
    ShieldCheck
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useConnectionHealth } from '../../hooks/useConnectionHealth';

interface ConnectionHealthProps {
    isOpen: boolean;
    onClose: () => void;
    connected: boolean;
    bitrateMbps?: number;
}

function Metric({
    icon: Icon,
    label,
    value,
    hint
}: {
    icon: typeof Gauge;
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30">
            <div className="flex items-center gap-1.5 mb-1">
                <Icon size={12} className="text-primary" />
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                    {label}
                </span>
            </div>
            <p className="text-[15px] font-black text-zinc-100">{value}</p>
            {hint && <p className="text-[8px] text-zinc-600 mt-0.5">{hint}</p>}
        </div>
    );
}

export default function ConnectionHealth({
    isOpen,
    onClose,
    connected,
    bitrateMbps
}: ConnectionHealthProps) {
    const { t } = useI18n();
    const m = useConnectionHealth({ connected, bitrateMbps, enabled: isOpen });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Gauge size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('connectionHealth.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide flex items-center gap-1">
                                {m.connected ? (
                                    <>
                                        <Wifi size={10} className="text-emerald-400" />
                                        {t('connectionHealth.active')}
                                    </>
                                ) : (
                                    <>
                                        <WifiOff size={10} />
                                        {t('connectionHealth.idle')}
                                    </>
                                )}
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

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
                    <div className="grid grid-cols-2 gap-2.5">
                        <Metric
                            icon={Gauge}
                            label={t('connectionHealth.fps')}
                            value={m.fps !== undefined ? `${m.fps}` : '—'}
                            hint={m.fps === undefined ? t('connectionHealth.fpsHint') : undefined}
                        />
                        <Metric
                            icon={Zap}
                            label={t('connectionHealth.bitrate')}
                            value={m.bitrateMbps ? `${m.bitrateMbps} Mbps` : '—'}
                        />
                        <Metric
                            icon={Cpu}
                            label={t('connectionHealth.codec')}
                            value={m.codec ? m.codec.toUpperCase() : '—'}
                        />
                        <Metric
                            icon={Film}
                            label={t('connectionHealth.droppedFrames')}
                            value={`${m.droppedFrames}`}
                        />
                    </div>

                    {m.fellBackToH264 && (
                        <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                            <AlertTriangle size={14} className="text-amber-400" />
                            <span className="text-[10px] font-bold text-amber-400">
                                {t('connectionHealth.fallbackNotice')}
                            </span>
                        </div>
                    )}

                    <div className="flex items-center gap-2 p-3 rounded-xl border border-primary/20 bg-primary/5">
                        <ShieldCheck size={14} className="text-primary" />
                        <span className="text-[9px] text-zinc-400 leading-relaxed">
                            {t('connectionHealth.autoFallbackInfo')}
                        </span>
                    </div>

                    <p className="text-[8px] text-zinc-600 leading-relaxed">
                        {t('connectionHealth.note')}
                    </p>
                </div>
            </div>
        </div>
    );
}
