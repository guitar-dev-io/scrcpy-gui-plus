import { Camera, FolderCog, ExternalLink, FolderOpen, Copy, Trash2, X, Loader2, ImageOff } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useI18n } from '../../i18n';
import type { ScreenshotHistoryEntry } from '../../types/screenshot';

interface ScreenshotManagerProps {
    history: ScreenshotHistoryEntry[];
    screenshotDir: string;
    isCapturing: boolean;
    canCapture: boolean;
    shortcutLabel: string;
    onCapture: () => void;
    onChangeDirectory: () => void;
    onOpenImage: (path: string) => void;
    onOpenFolder: (path: string) => void;
    onCopyImage: (path: string) => void;
    onDeleteEntry: (id: string, deleteFile: boolean) => void;
    onClearHistory: () => void;
    dashboard?: boolean;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export default function ScreenshotManager({
    history,
    screenshotDir,
    isCapturing,
    canCapture,
    shortcutLabel,
    onCapture,
    onChangeDirectory,
    onOpenImage,
    onOpenFolder,
    onCopyImage,
    onDeleteEntry,
    onClearHistory,
    dashboard = false
}: ScreenshotManagerProps) {
    const { t } = useI18n();

    return (
        <div className={dashboard
            ? 'space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[linear-gradient(145deg,rgba(23,29,43,.92),rgba(13,17,27,.96))] p-4 shadow-[0_14px_36px_rgba(0,0,0,.18)]'
            : 'glass p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-md space-y-3'}>
            <div className={`flex items-center justify-between border-b border-zinc-800/60 ${dashboard ? 'pb-3' : 'pb-2'}`}>
                <div className="flex items-center gap-2">
                    <Camera size={13} className="text-primary" />
                    <h2 className={`${dashboard ? 'text-[11px] font-semibold' : 'text-[10px] font-black'} uppercase text-zinc-400 tracking-widest`}>
                        {t('screenshot.title')}
                    </h2>
                </div>
                {history.length > 0 && (
                    <button
                        onClick={onClearHistory}
                        className="text-[8px] font-black uppercase text-zinc-600 hover:text-red-400 transition-colors tracking-wider"
                    >
                        {t('screenshot.clearHistory')}
                    </button>
                )}
            </div>

            {/* Capture button */}
            <button
                onClick={onCapture}
                disabled={!canCapture || isCapturing}
                title={t('screenshot.captureTooltip', { shortcut: shortcutLabel })}
                className={`w-full rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-all flex items-center justify-center gap-2 bg-primary text-on-primary disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] ${dashboard ? 'h-11 shadow-[0_8px_22px_rgba(var(--primary-rgb),.22)]' : 'py-2.5'}`}
            >
                {isCapturing ? (
                    <>
                        <Loader2 size={14} className="animate-spin" /> {t('screenshot.capturing')}
                    </>
                ) : (
                    <>
                        <Camera size={14} /> {t('screenshot.capture')}
                    </>
                )}
            </button>
            {!canCapture && (
                <p className="text-[8px] text-zinc-600 text-center uppercase tracking-wider">
                    {t('screenshot.noDevice')}
                </p>
            )}

            {/* Directory config */}
            <div className={dashboard ? 'space-y-2' : ''}>
                {dashboard && (
                    <div className="flex items-center justify-between">
                        <span className="text-[8px] font-semibold uppercase tracking-widest text-zinc-500">Save To</span>
                        <button type="button" onClick={onChangeDirectory} className="text-[8px] font-semibold uppercase text-primary hover:text-white">Change</button>
                    </div>
                )}
                <button
                    onClick={onChangeDirectory}
                    className={`w-full flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 hover:border-primary/50 transition-colors group text-left ${dashboard ? 'h-9 px-3' : 'px-2 py-1.5'}`}
                    title={t('screenshot.changeDirectory')}
                >
                    <FolderCog size={12} className="text-zinc-500 group-hover:text-primary shrink-0" />
                    <span className="text-[9px] text-zinc-400 truncate flex-1" dir="rtl">
                        {screenshotDir || '...'}
                    </span>
                </button>
            </div>

            {/* Recent list */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                        {t('screenshot.recent')}
                    </span>
                    {dashboard && history.length > 0 && <span className="text-[8px] text-primary">{history.length} captures</span>}
                </div>
                {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-zinc-700">
                        <ImageOff size={20} />
                        <span className="text-[9px] uppercase tracking-widest mt-1.5">
                            {t('screenshot.noHistory')}
                        </span>
                    </div>
                ) : (
                    <div className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-0.5">
                        {history.map((entry) => (
                            <div
                                key={entry.id}
                            className={`flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700 transition-colors group ${dashboard ? 'p-2' : 'p-1.5'}`}
                            >
                                <button
                                    onClick={() => onOpenImage(entry.path)}
                                    className={`shrink-0 rounded-md overflow-hidden border border-zinc-800 bg-black flex items-center justify-center ${dashboard ? 'h-14 w-14' : 'h-11 w-11'}`}
                                    title={t('screenshot.openImage')}
                                >
                                    <img
                                        src={convertFileSrc(entry.path)}
                                        alt={entry.filename}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-bold text-zinc-300 truncate">
                                        {entry.filename}
                                    </p>
                                    <p className="text-[8px] text-zinc-500 truncate">
                                        {entry.deviceName}
                                    </p>
                                    <p className="text-[8px] text-zinc-600 truncate">
                                        {formatDate(entry.capturedAt)}
                                    </p>
                                </div>
                                <div className="flex flex-col gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <div className="flex gap-0.5">
                                        <button
                                            onClick={() => onOpenImage(entry.path)}
                                            title={t('screenshot.openImage')}
                                            className="p-1 rounded text-zinc-500 hover:text-primary transition-colors"
                                        >
                                            <ExternalLink size={11} />
                                        </button>
                                        <button
                                            onClick={() => onOpenFolder(entry.path)}
                                            title={t('screenshot.openFolder')}
                                            className="p-1 rounded text-zinc-500 hover:text-primary transition-colors"
                                        >
                                            <FolderOpen size={11} />
                                        </button>
                                    </div>
                                    <div className="flex gap-0.5">
                                        <button
                                            onClick={() => onCopyImage(entry.path)}
                                            title={t('screenshot.copyImage')}
                                            className="p-1 rounded text-zinc-500 hover:text-primary transition-colors"
                                        >
                                            <Copy size={11} />
                                        </button>
                                        <button
                                            onClick={() => onDeleteEntry(entry.id, false)}
                                            title={t('screenshot.deleteEntry')}
                                            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                                        >
                                            <X size={11} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (window.confirm(t('screenshot.deleteFileConfirm', { filename: entry.filename }))) {
                                                    onDeleteEntry(entry.id, true);
                                                }
                                            }}
                                            title={t('screenshot.deleteFile')}
                                            className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={11} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
