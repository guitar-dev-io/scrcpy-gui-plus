import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    X,
    FlaskConical,
    Play,
    Square,
    Loader2,
    CheckCircle2,
    XCircle,
    MinusCircle,
    Circle,
    FolderOpen,
    ExternalLink,
    Download,
    Smartphone
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useTestSession } from '../../hooks/useTestSession';
import { openPath, revealInFolder } from '../../services/screenshotService';
import type {
    StepStatus,
    TestSessionOptions,
    TestSessionStepId
} from '../../types/testSession';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface TestSessionProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    outputDir: string;
    notify: ToolbarNotifier;
}

const STEP_ORDER: TestSessionStepId[] = [
    'clear_logcat',
    'show_touches',
    'device_info',
    'screenshot',
    'recording'
];

const OPTION_KEYS: { id: keyof TestSessionOptions; labelKey: string }[] = [
    { id: 'clearLogcat', labelKey: 'testSession.optClearLogcat' },
    { id: 'showTouches', labelKey: 'testSession.optShowTouches' },
    { id: 'deviceInfo', labelKey: 'testSession.optDeviceInfo' },
    { id: 'screenshot', labelKey: 'testSession.optScreenshot' },
    { id: 'recording', labelKey: 'testSession.optRecording' }
];

function StatusIcon({ status }: { status?: StepStatus }) {
    if (status === 'done') return <CheckCircle2 size={14} className="text-emerald-400" />;
    if (status === 'failed') return <XCircle size={14} className="text-red-400" />;
    if (status === 'skipped') return <MinusCircle size={14} className="text-zinc-600" />;
    if (status === 'running') return <Loader2 size={14} className="text-primary animate-spin" />;
    return <Circle size={14} className="text-zinc-700" />;
}

export default function TestSession({
    isOpen,
    onClose,
    activeDevice,
    customPath,
    outputDir,
    notify
}: TestSessionProps) {
    const { t } = useI18n();
    const session = useTestSession({ activeDevice, customPath, outputDir });
    const [localOpts, setLocalOpts] = useState<TestSessionOptions>(session.options);

    if (!isOpen) return null;

    const disabled = !activeDevice;

    const handleStart = async () => {
        const ok = await session.start(localOpts);
        if (ok) notify(t('testSession.startedTitle'), t('testSession.startedMessage'), 'info');
    };

    const handleStop = async () => {
        const result = await session.stop();
        if (result) {
            notify(
                t('testSession.doneTitle'),
                t('testSession.doneMessage', { count: result.screenshotPaths.length }),
                result.warnings.length > 0 ? 'warning' : 'success'
            );
        }
    };

    const handleExport = async () => {
        if (!session.summary) return;
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const name = `test-session_${activeDevice.replace(/[^a-zA-Z0-9]/g, '-')}_${ts}.json`;
            const content = JSON.stringify(session.summary, null, 2);
            const path = await invoke<string>('save_report', { content, name });
            notify(t('testSession.exportedTitle'), t('testSession.exportedMessage', { path }), 'success');
        } catch (e) {
            notify(t('testSession.exportFailedTitle'), String(e), 'error');
        }
    };

    const toggle = (id: keyof TestSessionOptions) =>
        setLocalOpts((o) => ({ ...o, [id]: !o[id] }));

    const info = session.summary?.deviceInfo;

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <FlaskConical size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('testSession.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('testSession.noDevice')}
                            </p>
                        </div>
                        {session.running && (
                            <span className="flex items-center gap-1 ml-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-[8px] font-black text-red-400 uppercase tracking-widest">
                                    {t('testSession.recording')}
                                </span>
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                    {/* Options (editable only before/when idle) */}
                    {!session.running && !session.summary && (
                        <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30 space-y-2">
                            <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
                                {t('testSession.include')}
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                                {OPTION_KEYS.map((opt) => (
                                    <button
                                        key={opt.id}
                                        onClick={() => toggle(opt.id)}
                                        className="flex items-center gap-2 text-left group"
                                    >
                                        <div
                                            className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                                                localOpts[opt.id]
                                                    ? 'bg-primary border-primary'
                                                    : 'border-zinc-700 group-hover:border-primary'
                                            }`}
                                        >
                                            {localOpts[opt.id] && (
                                                <div className="w-1.5 h-1.5 bg-black rounded-[1px]" />
                                            )}
                                        </div>
                                        <span className="text-[10px] font-bold text-zinc-300 group-hover:text-primary transition-colors">
                                            {t(opt.labelKey)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Live steps */}
                    {(session.running || session.busy || session.summary) && (
                        <div className="space-y-1.5">
                            <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
                                {t('testSession.steps')}
                            </span>
                            {STEP_ORDER.map((id) => (
                                <div
                                    key={id}
                                    className="flex items-center gap-2.5 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30"
                                >
                                    <StatusIcon status={session.steps[id]} />
                                    <span className="text-[10px] font-bold text-zinc-300">
                                        {t(`testSession.step_${id}`)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Summary */}
                    {session.summary && (
                        <div className="space-y-3">
                            {info && info.success && (
                                <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30 space-y-1.5">
                                    <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest flex items-center gap-1">
                                        <Smartphone size={11} /> {t('testSession.deviceInfo')}
                                    </span>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-zinc-400">
                                        <InfoRow label={t('testSession.infoModel')} value={`${info.manufacturer || ''} ${info.model || ''}`.trim()} />
                                        <InfoRow label={t('testSession.infoAndroid')} value={info.androidVersion ? `${info.androidVersion} (SDK ${info.sdk || '?'})` : undefined} />
                                        <InfoRow label={t('testSession.infoResolution')} value={info.resolution} />
                                        <InfoRow label={t('testSession.infoDensity')} value={info.density} />
                                        <InfoRow label={t('testSession.infoBattery')} value={info.battery ? `${info.battery}%` : undefined} />
                                        <InfoRow label={t('testSession.infoAbi')} value={info.abi} />
                                    </div>
                                </div>
                            )}

                            <div className="text-[10px] text-zinc-400 space-y-1">
                                <p>
                                    {t('testSession.duration', {
                                        seconds: Math.round(session.summary.durationMs / 1000)
                                    })}
                                </p>
                            </div>

                            {/* Artifacts */}
                            {session.summary.recordingPath && (
                                <ArtifactRow
                                    label={t('testSession.recordingFile')}
                                    path={session.summary.recordingPath}
                                    onOpen={openPath}
                                    onReveal={revealInFolder}
                                />
                            )}
                            {session.summary.screenshotPaths.map((p, i) => (
                                <ArtifactRow
                                    key={p}
                                    label={t('testSession.screenshotFile', { n: i + 1 })}
                                    path={p}
                                    onOpen={openPath}
                                    onReveal={revealInFolder}
                                />
                            ))}

                            {session.summary.warnings.length > 0 && (
                                <p className="text-[9px] text-amber-400/80">
                                    {t('testSession.warnings', {
                                        steps: session.summary.warnings.join(', ')
                                    })}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-zinc-800/60 flex gap-3">
                    {session.summary ? (
                        <>
                            <button
                                onClick={() => session.reset()}
                                className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all"
                            >
                                {t('testSession.newSession')}
                            </button>
                            <button
                                onClick={handleExport}
                                className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                            >
                                <Download size={13} /> {t('testSession.exportSummary')}
                            </button>
                        </>
                    ) : session.running ? (
                        <button
                            onClick={handleStop}
                            disabled={session.busy}
                            className="w-full py-2.5 rounded-xl border border-red-500/50 bg-red-500/10 text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                            {session.busy ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
                            {t('testSession.stop')}
                        </button>
                    ) : (
                        <button
                            onClick={handleStart}
                            disabled={disabled || session.busy}
                            className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                        >
                            {session.busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                            {t('testSession.start')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
    if (!value || !value.trim()) return null;
    return (
        <div className="flex flex-col">
            <span className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">
                {label}
            </span>
            <span className="text-zinc-300 truncate">{value}</span>
        </div>
    );
}

function ArtifactRow({
    label,
    path,
    onOpen,
    onReveal
}: {
    label: string;
    path: string;
    onOpen: (p: string) => void;
    onReveal: (p: string) => void;
}) {
    return (
        <div className="flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30">
            <div className="flex-1 min-w-0">
                <p className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">
                    {label}
                </p>
                <p className="text-[10px] text-zinc-300 font-mono truncate">{path}</p>
            </div>
            <button
                onClick={() => onOpen(path)}
                title={label}
                className="p-1.5 rounded text-zinc-500 hover:text-primary transition-colors"
            >
                <ExternalLink size={12} />
            </button>
            <button
                onClick={() => onReveal(path)}
                title={label}
                className="p-1.5 rounded text-zinc-500 hover:text-primary transition-colors"
            >
                <FolderOpen size={12} />
            </button>
        </div>
    );
}
