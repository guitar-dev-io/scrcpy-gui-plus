import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
    X,
    FolderTree,
    RefreshCw,
    ArrowUp,
    Folder,
    FileIcon,
    ImageIcon,
    Link as LinkIcon,
    Download,
    Upload,
    Trash2,
    FolderPlus,
    Loader2,
    Eye,
    ChevronRight
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useFileManager } from '../../hooks/useFileManager';
import { openPath, revealInFolder } from '../../services/screenshotService';
import {
    breadcrumbs,
    formatSize,
    isImageFile,
    type FileEntry
} from '../../types/fileManager';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface FileManagerProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    /** Default local directory for downloads. */
    defaultDownloadDir: string;
    confirmAction: (title: string, message: string, onConfirm: () => void) => void;
    notify: ToolbarNotifier;
}

export default function FileManager({
    isOpen,
    onClose,
    activeDevice,
    customPath,
    defaultDownloadDir,
    confirmAction,
    notify
}: FileManagerProps) {
    const { t } = useI18n();
    const fm = useFileManager({ activeDevice, customPath, enabled: isOpen });
    const [newFolder, setNewFolder] = useState('');
    const [showNewFolder, setShowNewFolder] = useState(false);

    if (!isOpen) return null;

    const handlePull = async (entry: FileEntry) => {
        let dir = defaultDownloadDir;
        const chosen = await openDialog({
            directory: true,
            multiple: false,
            defaultPath: defaultDownloadDir || undefined
        }).catch(() => null);
        if (typeof chosen === 'string') dir = chosen;
        if (!dir) return;
        const res = await fm.pull(entry, dir);
        if (res.success) {
            notify(t('fileManager.pulledTitle'), t('fileManager.pulledMessage', { path: res.path || '' }), 'success');
        } else {
            notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
        }
    };

    const handlePush = async () => {
        const chosen = await openDialog({ multiple: false }).catch(() => null);
        if (typeof chosen !== 'string') return;
        const res = await fm.push(chosen);
        if (res.success) {
            notify(t('fileManager.pushedTitle'), t('fileManager.pushedMessage'), 'success');
        } else {
            notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
        }
    };

    const handleDelete = (entry: FileEntry) => {
        confirmAction(
            t('fileManager.deleteTitle'),
            t('fileManager.deleteMessage', { name: entry.name }),
            async () => {
                const res = await fm.remove(entry);
                if (!res.success) {
                    notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
                }
            }
        );
    };

    const handleMkdir = async () => {
        const name = newFolder.trim();
        if (!name) return;
        const res = await fm.mkdir(name);
        if (res.success) {
            setNewFolder('');
            setShowNewFolder(false);
        } else {
            notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
        }
    };

    const crumbs = breadcrumbs(fm.cwd);

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <FolderTree size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('fileManager.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('fileManager.noDevice')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={fm.refresh} disabled={fm.loading || !activeDevice} title={t('common.refresh')} className="p-2 rounded-xl text-zinc-500 hover:text-primary hover:bg-white/5 transition-all disabled:opacity-30">
                            <RefreshCw size={16} className={fm.loading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={onClose} className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Toolbar: breadcrumb + actions */}
                <div className="px-6 py-2.5 border-b border-zinc-800/60 space-y-2">
                    <div className="flex items-center gap-1 flex-wrap">
                        <button onClick={fm.goUp} disabled={fm.cwd === '/'} title={t('fileManager.up')} className="p-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all disabled:opacity-30">
                            <ArrowUp size={13} />
                        </button>
                        <div className="flex items-center gap-0.5 flex-wrap text-[10px] font-mono">
                            {crumbs.map((c, i) => (
                                <span key={c.path} className="flex items-center gap-0.5">
                                    {i > 0 && <ChevronRight size={10} className="text-zinc-700" />}
                                    <button
                                        onClick={() => fm.goTo(c.path)}
                                        className={`px-1 py-0.5 rounded hover:bg-white/5 transition-colors ${
                                            i === crumbs.length - 1 ? 'text-primary font-bold' : 'text-zinc-400'
                                        }`}
                                    >
                                        {c.label}
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={handlePush} disabled={!activeDevice || fm.busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30">
                            <Upload size={12} /> {t('fileManager.upload')}
                        </button>
                        <button onClick={() => setShowNewFolder((s) => !s)} disabled={!activeDevice} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30">
                            <FolderPlus size={12} /> {t('fileManager.newFolder')}
                        </button>
                        {fm.busy && <Loader2 size={13} className="animate-spin text-zinc-500 ml-1" />}
                    </div>
                    {showNewFolder && (
                        <div className="flex items-center gap-1.5">
                            <input
                                value={newFolder}
                                onChange={(e) => setNewFolder(e.target.value)}
                                placeholder={t('fileManager.folderNamePlaceholder')}
                                className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                            />
                            <button onClick={handleMkdir} disabled={!newFolder.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30">
                                {t('fileManager.create')}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 flex min-h-0">
                    {/* Entry list */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                        {!activeDevice ? (
                            <Empty label={t('fileManager.noDevice')} />
                        ) : fm.loading ? (
                            <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                                <Loader2 size={22} className="animate-spin" />
                                <span className="text-[10px] uppercase tracking-widest mt-2">{t('fileManager.loading')}</span>
                            </div>
                        ) : fm.error ? (
                            <Empty
                                label={
                                    t(`fileManager.errors.${fm.error}`) !== `fileManager.errors.${fm.error}`
                                        ? t(`fileManager.errors.${fm.error}`)
                                        : fm.error
                                }
                            />
                        ) : fm.entries.length === 0 ? (
                            <Empty label={t('fileManager.empty')} />
                        ) : (
                            <div className="space-y-0.5">
                                {fm.entries.map((entry) => {
                                    const isImage = !entry.isDir && isImageFile(entry.name);
                                    const Icon = entry.isDir ? Folder : entry.isLink ? LinkIcon : isImage ? ImageIcon : FileIcon;
                                    return (
                                        <div key={entry.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] group">
                                            <button
                                                onClick={() => (entry.isDir || entry.isLink ? fm.open(entry) : isImage ? fm.preview(entry) : undefined)}
                                                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                            >
                                                <Icon size={15} className={entry.isDir ? 'text-primary shrink-0' : 'text-zinc-500 shrink-0'} />
                                                <span className="text-[11px] text-zinc-200 truncate">{entry.name}</span>
                                                {entry.size !== undefined && !entry.isDir && (
                                                    <span className="text-[8px] text-zinc-600 ml-auto shrink-0">{formatSize(entry.size)}</span>
                                                )}
                                            </button>
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                {isImage && (
                                                    <button onClick={() => fm.preview(entry)} title={t('fileManager.preview')} className="p-1 rounded text-zinc-500 hover:text-primary transition-colors">
                                                        <Eye size={12} />
                                                    </button>
                                                )}
                                                <button onClick={() => handlePull(entry)} title={t('fileManager.download')} className="p-1 rounded text-zinc-500 hover:text-primary transition-colors">
                                                    <Download size={12} />
                                                </button>
                                                <button onClick={() => handleDelete(entry)} title={t('fileManager.delete')} className="p-1 rounded text-zinc-500 hover:text-red-400 transition-colors">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Preview pane */}
                    {fm.previewName && (
                        <div className="w-64 border-l border-zinc-800/60 flex flex-col p-3 shrink-0">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest truncate">
                                    {fm.previewName}
                                </span>
                                <button onClick={fm.closePreview} className="p-1 rounded text-zinc-500 hover:text-white transition-colors">
                                    <X size={13} />
                                </button>
                            </div>
                            <div className="flex-1 flex items-center justify-center rounded-lg border border-zinc-800 bg-black/40 overflow-hidden">
                                {fm.previewLoading ? (
                                    <Loader2 size={20} className="animate-spin text-zinc-600" />
                                ) : fm.previewLocalPath ? (
                                    <img src={convertFileSrc(fm.previewLocalPath)} alt={fm.previewName} className="max-w-full max-h-full object-contain" />
                                ) : (
                                    <span className="text-[9px] text-zinc-600 uppercase tracking-widest px-4 text-center">
                                        {t('fileManager.previewFailed')}
                                    </span>
                                )}
                            </div>
                            {fm.previewLocalPath && (
                                <div className="flex gap-1.5 mt-2">
                                    <button onClick={() => openPath(fm.previewLocalPath!)} className="flex-1 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 text-[8px] font-black uppercase tracking-widest hover:border-primary/50 transition-all">
                                        {t('fileManager.openFile')}
                                    </button>
                                    <button onClick={() => revealInFolder(fm.previewLocalPath!)} className="flex-1 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 text-[8px] font-black uppercase tracking-widest hover:border-primary/50 transition-all">
                                        {t('fileManager.openFolder')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Empty({ label }: { label: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
            <FolderTree size={22} />
            <span className="text-[10px] uppercase tracking-widest mt-2 text-center px-6">{label}</span>
        </div>
    );
}
