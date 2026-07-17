import {
    X,
    Activity,
    RefreshCw,
    BatteryCharging,
    BatteryMedium,
    Smartphone,
    Wifi,
    Usb,
    MonitorSmartphone,
    HardDrive,
    MemoryStick,
    Loader2,
    CheckCircle2
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { connectionTypeOf, formatKb, type DeviceStatus as DeviceStatusModel } from '../../types/deviceStatus';

interface DeviceStatusProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
}

function UsageBar({ used, total }: { used?: number; total?: number }) {
    if (!used || !total || total === 0) return null;
    const pct = Math.min(100, Math.round((used / total) * 100));
    return (
        <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-1">
            <div
                className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-primary'}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

function StatCard({
    icon: Icon,
    label,
    value,
    children
}: {
    icon: typeof Activity;
    label: string;
    value?: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30">
            <div className="flex items-center gap-1.5 mb-1">
                <Icon size={12} className="text-primary" />
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                    {label}
                </span>
            </div>
            <p className="text-[13px] font-bold text-zinc-200 truncate">{value || '—'}</p>
            {children}
        </div>
    );
}

export default function DeviceStatus({
    isOpen,
    onClose,
    activeDevice,
    customPath
}: DeviceStatusProps) {
    const { t } = useI18n();
    const { status, loading, refresh } = useDeviceStatus({
        activeDevice,
        customPath,
        autoRefresh: true,
        intervalMs: 5000,
        enabled: isOpen
    });

    if (!isOpen) return null;

    const s: DeviceStatusModel | null = status;
    const conn = activeDevice ? connectionTypeOf(activeDevice) : 'usb';
    const storageUsedPct =
        s?.storageTotalKb && s?.storageUsedKb
            ? Math.round((s.storageUsedKb / s.storageTotalKb) * 100)
            : undefined;
    const memUsed =
        s?.memTotalKb && s?.memAvailableKb ? s.memTotalKb - s.memAvailableKb : undefined;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Activity size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('deviceStatus.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('deviceStatus.noDevice')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => void refresh()}
                            disabled={!activeDevice || loading}
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

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    {!activeDevice ? (
                        <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
                            <Smartphone size={22} />
                            <span className="text-[10px] uppercase tracking-widest mt-2">
                                {t('deviceStatus.noDevice')}
                            </span>
                        </div>
                    ) : !s && loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                            <Loader2 size={22} className="animate-spin" />
                            <span className="text-[10px] uppercase tracking-widest mt-2">
                                {t('deviceStatus.loading')}
                            </span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2.5">
                            <StatCard
                                icon={Smartphone}
                                label={t('deviceStatus.model')}
                                value={`${s?.manufacturer || ''} ${s?.model || ''}`.trim() || '—'}
                            />
                            <StatCard
                                icon={MonitorSmartphone}
                                label={t('deviceStatus.android')}
                                value={
                                    s?.androidVersion
                                        ? `${s.androidVersion} (SDK ${s.sdk || '?'})`
                                        : '—'
                                }
                            />
                            <StatCard
                                icon={s?.charging ? BatteryCharging : BatteryMedium}
                                label={t('deviceStatus.battery')}
                                value={
                                    s?.batteryLevel !== undefined
                                        ? `${s.batteryLevel}%${s.charging ? ' ⚡' : ''}`
                                        : '—'
                                }
                            >
                                <UsageBar used={s?.batteryLevel} total={100} />
                            </StatCard>
                            <StatCard
                                icon={MonitorSmartphone}
                                label={t('deviceStatus.resolution')}
                                value={s?.resolution ? `${s.resolution}${s.density ? ` @${s.density}dpi` : ''}` : '—'}
                            />
                            <StatCard
                                icon={conn === 'wifi' ? Wifi : Usb}
                                label={t('deviceStatus.connection')}
                                value={conn === 'wifi' ? t('deviceStatus.wifi') : t('deviceStatus.usb')}
                            />
                            <StatCard
                                icon={Wifi}
                                label={t('deviceStatus.ipAddress')}
                                value={s?.ipAddress || '—'}
                            />
                            <StatCard
                                icon={HardDrive}
                                label={t('deviceStatus.storage')}
                                value={
                                    s?.storageTotalKb
                                        ? `${formatKb(s.storageUsedKb)} / ${formatKb(s.storageTotalKb)}${
                                              storageUsedPct !== undefined ? ` (${storageUsedPct}%)` : ''
                                          }`
                                        : '—'
                                }
                            >
                                <UsageBar used={s?.storageUsedKb} total={s?.storageTotalKb} />
                            </StatCard>
                            <StatCard
                                icon={MemoryStick}
                                label={t('deviceStatus.memory')}
                                value={
                                    s?.memTotalKb
                                        ? `${formatKb(memUsed)} / ${formatKb(s.memTotalKb)}`
                                        : '—'
                                }
                            >
                                <UsageBar used={memUsed} total={s?.memTotalKb} />
                            </StatCard>
                            <div className="col-span-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2">
                                <CheckCircle2 size={14} className="text-emerald-400" />
                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                                    {t('deviceStatus.adbConnected')}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
