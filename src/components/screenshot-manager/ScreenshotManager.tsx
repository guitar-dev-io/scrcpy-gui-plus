import { Camera, FolderCog, ExternalLink, FolderOpen, Copy, Trash2, Loader2, ImageOff } from 'lucide-react';
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
    onDeleteEntry: (id: string) => void;
    onClearHistory: () => void;
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
    onClearHistory
}: ScreenshotManagerProps) {
    const { t } = useI18n();

    return (
        <div className="glass p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-md space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                <div className="flex items-center gap-2">
                    <Camera size={13} className="text-primary" />
                    <h2 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">
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
                className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 bg-primary text-on-primary disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
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
            <button
                onClick={onChangeDirectory}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 hover:border-primary/50 transition-colors group text-left"
                title={t('screenshot.changeDirectory')}
            >
                <FolderCog size={12} className="text-zinc-500 group-hover:text-primary shrink-0" />
                <span className="text-[9px] text-zinc-400 truncate flex-1" dir="rtl">
                    {screenshotDir || '...'}
                </span>
            </button>

            {/* Recent list */}
            <div className="space-y-1.5">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                    {t('screenshot.recent')}
                </span>
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
                                className="flex items-center gap-2 p-1.5 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700 transition-colors group"
                            >
                                <button
                                    onClick={() => onOpenImage(entry.path)}
                                    className="shrink-0 w-11 h-11 rounded-md overflow-hidden border border-zinc-800 bg-black flex items-center justify-center"
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
                                            onClick={() => onDeleteEntry(entry.id)}
                                            title={t('screenshot.deleteEntry')}
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
