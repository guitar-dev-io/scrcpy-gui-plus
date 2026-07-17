import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
    X,
    Bug,
    Loader2,
    CheckCircle2,
    XCircle,
    MinusCircle,
    FolderOpen,
    ExternalLink,
    Copy,
    FileArchive
} from 'lucide-react';
import { useI18n } from '../../i18n';
import {
    cancelBugReport,
    createBugReport,
    onBugReportProgress
} from '../../services/bugReportService';
import { openPath, revealInFolder } from '../../services/screenshotService';
import type {
    BugReportProgress,
    BugReportResult,
    BugReportStepStatus
} from '../../types/bugReport';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface BugReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    deviceName?: string;
    customPath?: string;
    defaultOutputDir: string;
    latestScreenshotPath?: string;
    notify: ToolbarNotifier;
}

interface FormState {
    title: string;
    description: string;
    steps: string;
    expected: string;
    actual: string;
    packageName: string;
    includeCurrentScreenshot: boolean;
    includeNewScreenshot: boolean;
    includeLogcat: boolean;
    includeDeviceInfo: boolean;
    includeAppInfo: boolean;
    includeRecording: boolean;
}

const initialForm: FormState = {
    title: '',
    description: '',
    steps: '',
    expected: '',
    actual: '',
    packageName: '',
    includeCurrentScreenshot: false,
    includeNewScreenshot: true,
    includeLogcat: true,
    includeDeviceInfo: true,
    includeAppInfo: false,
    includeRecording: false
};

export default function BugReportModal({
    isOpen,
    onClose,
    activeDevice,
    deviceName,
    customPath,
    defaultOutputDir,
    latestScreenshotPath,
    notify
}: BugReportModalProps) {
    const { t } = useI18n();
    const [form, setForm] = useState<FormState>(initialForm);
    const [outputDir, setOutputDir] = useState(defaultOutputDir);
    const [recordingPath, setRecordingPath] = useState('');
    const [generating, setGenerating] = useState(false);
    const [progress, setProgress] = useState<Record<string, BugReportStepStatus>>({});
    const [result, setResult] = useState<BugReportResult | null>(null);
    const unlistenRef = useRef<null | (() => void)>(null);

    useEffect(() => {
        if (isOpen) {
            setOutputDir((prev) => prev || defaultOutputDir);
        }
    }, [isOpen, defaultOutputDir]);

    useEffect(() => {
        return () => {
            if (unlistenRef.current) unlistenRef.current();
        };
    }, []);

    if (!isOpen) return null;

    const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((f) => ({ ...f, [key]: value }));
    };

    const pickRecording = async () => {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'webm', 'mov'] }]
        });
        if (typeof selected === 'string') setRecordingPath(selected);
    };

    const pickOutputDir = async () => {
        const selected = await open({ directory: true, multiple: false, defaultPath: outputDir || undefined });
        if (typeof selected === 'string') setOutputDir(selected);
    };

    const handleGenerate = async () => {
        if (!activeDevice) {
            notify(t('bugReport.noDeviceTitle'), t('bugReport.noDeviceMessage'), 'warning');
            return;
        }
        setResult(null);
        setProgress({});
        setGenerating(true);

        unlistenRef.current = await onBugReportProgress((p: BugReportProgress) => {
            setProgress((prev) => ({ ...prev, [p.step]: p.status }));
        });

        try {
            const res = await createBugReport({
                deviceSerial: activeDevice,
                deviceName,
                title: form.title,
                description: form.description,
                steps: form.steps,
                expected: form.expected,
                actual: form.actual,
                packageName: form.packageName || undefined,
                outputDir,
                includeCurrentScreenshot: form.includeCurrentScreenshot,
                currentScreenshotPath: latestScreenshotPath,
                includeNewScreenshot: form.includeNewScreenshot,
                includeLogcat: form.includeLogcat,
                includeDeviceInfo: form.includeDeviceInfo,
                includeAppInfo: form.includeAppInfo,
                includeRecording: form.includeRecording,
                recordingPath: recordingPath || undefined,
                customPath
            });
            setResult(res);
            if (res.success && res.warnings.length > 0) {
                notify(t('bugReport.done'), res.warnings.join('\n'), 'warning');
            } else if (!res.success && !res.cancelled) {
                notify(t('bugReport.failedTitle'), res.error || 'Unknown error', 'error');
            }
        } catch (e) {
            notify(t('bugReport.failedTitle'), String(e), 'error');
        } finally {
            setGenerating(false);
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
        }
    };

    const handleCancel = async () => {
        await cancelBugReport();
    };

    const handleClose = () => {
        if (generating) return;
        setForm(initialForm);
        setRecordingPath('');
        setResult(null);
        setProgress({});
        onClose();
    };

    const copyPath = async (path: string) => {
        try {
            await navigator.clipboard.writeText(path);
            notify(t('bugReport.done'), t('bugReport.copiedPath'), 'success');
        } catch {
            notify(t('bugReport.failedTitle'), 'Clipboard error', 'error');
        }
    };

    const stepOrder = [
        'device-info',
        'app-info',
        'logcat',
        'screenshot',
        'recording',
        'report',
        'package'
    ];

    const StatusIcon = ({ status }: { status?: BugReportStepStatus }) => {
        if (status === 'done') return <CheckCircle2 size={13} className="text-emerald-400" />;
        if (status === 'failed') return <XCircle size={13} className="text-red-400" />;
        if (status === 'skipped') return <MinusCircle size={13} className="text-zinc-600" />;
        if (status === 'running') return <Loader2 size={13} className="text-primary animate-spin" />;
        return <div className="w-[13px] h-[13px] rounded-full border border-zinc-700" />;
    };

    const Checkbox = ({
        checked,
        onChange,
        label
    }: {
        checked: boolean;
        onChange: (v: boolean) => void;
        label: string;
    }) => (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className="flex items-center gap-2 text-left group"
        >
            <div
                className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                    checked ? 'bg-primary border-primary' : 'border-zinc-700 group-hover:border-primary'
                }`}
            >
                {checked && <div className="w-1.5 h-1.5 bg-black rounded-[1px]" />}
            </div>
            <span className="text-[10px] font-bold text-zinc-300 group-hover:text-primary transition-colors">
                {label}
            </span>
        </button>
    );

    const inputCls =
        'w-full bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-300 focus:border-primary/60 focus:outline-none transition-colors';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
                onClick={handleClose}
            />
            <div className="relative w-full max-w-2xl max-h-[88vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <Bug size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('bugReport.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {t('bugReport.subtitle')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={generating}
                        className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all disabled:opacity-30"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                    {result ? (
                        /* Result screen */
                        <div className="space-y-4">
                            <div
                                className={`flex items-center gap-3 p-4 rounded-2xl border ${
                                    result.success
                                        ? 'border-emerald-500/30 bg-emerald-500/5'
                                        : result.cancelled
                                          ? 'border-zinc-700 bg-zinc-800/20'
                                          : 'border-red-500/30 bg-red-500/5'
                                }`}
                            >
                                {result.success ? (
                                    <FileArchive size={28} className="text-emerald-400" />
                                ) : (
                                    <XCircle size={28} className="text-red-400" />
                                )}
                                <div>
                                    <h4 className="text-sm font-black uppercase tracking-wide text-white">
                                        {result.success
                                            ? t('bugReport.done')
                                            : result.cancelled
                                              ? t('bugReport.cancelledTitle')
                                              : t('bugReport.failedTitle')}
                                    </h4>
                                    {result.error && (
                                        <p className="text-[10px] text-zinc-400">{result.error}</p>
                                    )}
                                </div>
                            </div>

                            {result.success && (
                                <>
                                    <div>
                                        <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                            {t('bugReport.zipPath')}
                                        </span>
                                        <p className="text-[10px] text-zinc-300 font-mono break-all mt-1">
                                            {result.zipPath}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => openPath(result.zipPath)}
                                            className="flex-1 py-2 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:brightness-110 transition-all"
                                        >
                                            <ExternalLink size={12} /> {t('bugReport.openFile')}
                                        </button>
                                        <button
                                            onClick={() => revealInFolder(result.zipPath)}
                                            className="flex-1 py-2 rounded-xl border border-zinc-800 text-zinc-300 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:border-primary/50 transition-all"
                                        >
                                            <FolderOpen size={12} /> {t('bugReport.openFolder')}
                                        </button>
                                        <button
                                            onClick={() => copyPath(result.zipPath)}
                                            className="flex-1 py-2 rounded-xl border border-zinc-800 text-zinc-300 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 hover:border-primary/50 transition-all"
                                        >
                                            <Copy size={12} /> {t('bugReport.copyPath')}
                                        </button>
                                    </div>
                                    <div>
                                        <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                            {t('bugReport.includedFiles')}
                                        </span>
                                        <ul className="mt-1 space-y-0.5">
                                            {result.includedFiles.map((f) => (
                                                <li key={f} className="text-[10px] text-zinc-400 font-mono">
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </>
                            )}

                            {result.warnings.length > 0 && (
                                <div>
                                    <span className="text-[8px] font-black uppercase text-amber-500 tracking-widest">
                                        {t('bugReport.warnings')}
                                    </span>
                                    <ul className="mt-1 space-y-0.5">
                                        {result.warnings.map((w, i) => (
                                            <li key={i} className="text-[10px] text-amber-400/80">
                                                • {w}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : generating ? (
                        /* Progress screen */
                        <div className="space-y-2">
                            <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
                                {t('bugReport.progress')}
                            </span>
                            {stepOrder.map((step) => {
                                const status = progress[step];
                                if (!status) return null;
                                return (
                                    <div
                                        key={step}
                                        className="flex items-center gap-2.5 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30"
                                    >
                                        <StatusIcon status={status} />
                                        <span className="text-[10px] font-bold text-zinc-300">
                                            {t(`bugReport.steps_${step}`)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* Form screen */
                        <>
                            <div className="space-y-2">
                                <input
                                    className={inputCls}
                                    placeholder={t('bugReport.reportTitlePlaceholder')}
                                    value={form.title}
                                    onChange={(e) => setField('title', e.target.value)}
                                />
                                <textarea
                                    className={`${inputCls} resize-none`}
                                    rows={2}
                                    placeholder={t('bugReport.descriptionPlaceholder')}
                                    value={form.description}
                                    onChange={(e) => setField('description', e.target.value)}
                                />
                                <div className="grid grid-cols-1 gap-2">
                                    <textarea
                                        className={`${inputCls} resize-none`}
                                        rows={2}
                                        placeholder={t('bugReport.stepsPlaceholder')}
                                        value={form.steps}
                                        onChange={(e) => setField('steps', e.target.value)}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input
                                            className={inputCls}
                                            placeholder={t('bugReport.expectedPlaceholder')}
                                            value={form.expected}
                                            onChange={(e) => setField('expected', e.target.value)}
                                        />
                                        <input
                                            className={inputCls}
                                            placeholder={t('bugReport.actualPlaceholder')}
                                            value={form.actual}
                                            onChange={(e) => setField('actual', e.target.value)}
                                        />
                                    </div>
                                    <input
                                        className={inputCls}
                                        placeholder={t('bugReport.packageNamePlaceholder')}
                                        value={form.packageName}
                                        onChange={(e) => setField('packageName', e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30 space-y-2">
                                <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
                                    {t('bugReport.include')}
                                </span>
                                <div className="grid grid-cols-2 gap-2">
                                    <Checkbox
                                        checked={form.includeCurrentScreenshot}
                                        onChange={(v) => setField('includeCurrentScreenshot', v)}
                                        label={t('bugReport.includeCurrentScreenshot')}
                                    />
                                    <Checkbox
                                        checked={form.includeNewScreenshot}
                                        onChange={(v) => setField('includeNewScreenshot', v)}
                                        label={t('bugReport.includeNewScreenshot')}
                                    />
                                    <Checkbox
                                        checked={form.includeLogcat}
                                        onChange={(v) => setField('includeLogcat', v)}
                                        label={t('bugReport.includeLogcat')}
                                    />
                                    <Checkbox
                                        checked={form.includeDeviceInfo}
                                        onChange={(v) => setField('includeDeviceInfo', v)}
                                        label={t('bugReport.includeDeviceInfo')}
                                    />
                                    <Checkbox
                                        checked={form.includeAppInfo}
                                        onChange={(v) => setField('includeAppInfo', v)}
                                        label={t('bugReport.includeAppInfo')}
                                    />
                                    <Checkbox
                                        checked={form.includeRecording}
                                        onChange={(v) => setField('includeRecording', v)}
                                        label={t('bugReport.includeRecording')}
                                    />
                                </div>
                                {form.includeRecording && (
                                    <button
                                        onClick={pickRecording}
                                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 hover:border-primary/50 transition-colors text-left mt-1"
                                    >
                                        <FolderOpen size={12} className="text-zinc-500 shrink-0" />
                                        <span className="text-[9px] text-zinc-400 truncate flex-1">
                                            {recordingPath || t('bugReport.chooseRecording')}
                                        </span>
                                    </button>
                                )}
                            </div>

                            <button
                                onClick={pickOutputDir}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 hover:border-primary/50 transition-colors text-left"
                            >
                                <FolderOpen size={12} className="text-zinc-500 shrink-0" />
                                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                    {t('bugReport.outputDir')}:
                                </span>
                                <span className="text-[9px] text-zinc-400 truncate flex-1" dir="rtl">
                                    {outputDir || '...'}
                                </span>
                            </button>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-zinc-800/60 flex gap-3">
                    {result ? (
                        <button
                            onClick={handleClose}
                            className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                            {t('bugReport.close')}
                        </button>
                    ) : generating ? (
                        <button
                            onClick={handleCancel}
                            className="w-full py-2.5 rounded-xl border border-red-500/50 text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 transition-all"
                        >
                            {t('bugReport.cancel')}
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleClose}
                                className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all"
                            >
                                {t('bugReport.close')}
                            </button>
                            <button
                                onClick={handleGenerate}
                                disabled={!activeDevice || !outputDir}
                                className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                            >
                                <Bug size={12} /> {t('bugReport.generate')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
