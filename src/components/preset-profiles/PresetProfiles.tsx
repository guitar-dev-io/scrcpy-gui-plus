import { useState } from 'react';
import { X, Wand2, Gamepad2, FlaskConical, Presentation, Gauge, Check } from 'lucide-react';
import { useI18n } from '../../i18n';
import {
    DEVICE_PROFILES_KEY,
    PRESET_PROFILES,
    type DeviceProfileMap,
    type PresetId
} from '../../types/presetProfiles';
import type { ScrcpyConfig } from '../../hooks/useScrcpy';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface PresetProfilesProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    setConfig: (updater: (prev: ScrcpyConfig) => ScrcpyConfig) => void;
    notify: ToolbarNotifier;
}

const PRESET_ICONS: Record<PresetId, typeof Wand2> = {
    gaming: Gamepad2,
    testing: FlaskConical,
    presentation: Presentation,
    lowBandwidth: Gauge
};

function loadProfiles(): DeviceProfileMap {
    try {
        const raw = localStorage.getItem(DEVICE_PROFILES_KEY);
        return raw ? (JSON.parse(raw) as DeviceProfileMap) : {};
    } catch {
        return {};
    }
}

function saveProfiles(map: DeviceProfileMap) {
    try {
        localStorage.setItem(DEVICE_PROFILES_KEY, JSON.stringify(map));
    } catch {
        // ignore storage failures
    }
}

export default function PresetProfiles({
    isOpen,
    onClose,
    activeDevice,
    setConfig,
    notify
}: PresetProfilesProps) {
    const { t } = useI18n();
    const [profiles, setProfiles] = useState<DeviceProfileMap>(() => loadProfiles());

    if (!isOpen) return null;

    const currentPreset = activeDevice ? profiles[activeDevice] : undefined;

    const applyPreset = (id: PresetId) => {
        const preset = PRESET_PROFILES.find((p) => p.id === id);
        if (!preset) return;
        setConfig((prev) => ({ ...prev, ...preset.config }));
        if (activeDevice) {
            const next = { ...profiles, [activeDevice]: id };
            setProfiles(next);
            saveProfiles(next);
        }
        notify(
            t('presets.appliedTitle'),
            t('presets.appliedMessage', { name: t(preset.labelKey) }),
            'success'
        );
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Wand2 size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('presets.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('presets.noDevice')}
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

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-2.5">
                    {PRESET_PROFILES.map((preset) => {
                        const Icon = PRESET_ICONS[preset.id];
                        const isActive = currentPreset === preset.id;
                        return (
                            <button
                                key={preset.id}
                                onClick={() => applyPreset(preset.id)}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                                    isActive
                                        ? 'border-primary/50 bg-primary/5'
                                        : 'border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700'
                                }`}
                            >
                                <div
                                    className={`p-2 rounded-lg ${
                                        isActive ? 'bg-primary text-on-primary' : 'bg-zinc-800 text-zinc-400'
                                    }`}
                                >
                                    <Icon size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-bold text-zinc-200">
                                        {t(preset.labelKey)}
                                    </p>
                                    <p className="text-[9px] text-zinc-500">{t(preset.descKey)}</p>
                                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">
                                        {preset.config.bitrate}Mbps · {preset.config.fps}fps ·{' '}
                                        {preset.config.res === '0'
                                            ? t('presets.original')
                                            : `${preset.config.res}px`}
                                        {preset.config.audioEnabled === false
                                            ? ` · ${t('presets.noAudio')}`
                                            : ''}
                                    </p>
                                </div>
                                {isActive && <Check size={16} className="text-primary shrink-0" />}
                            </button>
                        );
                    })}

                    <p className="text-[8px] text-zinc-600 leading-relaxed pt-1">
                        {t('presets.note')}
                    </p>
                </div>
            </div>
        </div>
    );
}
