import { useMemo, useState } from 'react';
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
    ChevronRight,
    HardDrive,
    Files,
    FolderOpen
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useFileManager } from '../../hooks/useFileManager';
import { openPath, revealInFolder } from '../../services/screenshotService';
import { breadcrumbs, formatSize, isImageFile, type FileEntry } from '../../types/fileManager';
import FileExplorerWorkspace from './FileExplorerWorkspace'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface FileManagerProps {
    isOpen: boolean;
    embedded?: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
    defaultDownloadDir: string;
    confirmAction: (title: string, message: string, onConfirm: () => void) => void;
    notify: ToolbarNotifier;
}

export default function FileManager({
    isOpen,
    embedded = false,
    onClose,
    activeDevice,
    customPath,
    defaultDownloadDir,
    confirmAction,
    notify
}: FileManagerProps) {
    const { t } = useI18n();
    const fm = useFileManager({ activeDevice, customPath, enabled: isOpen || embedded });
    const [newFolder, setNewFolder] = useState('');
    const [showNewFolder, setShowNewFolder] = useState(false);

    const folderCount = useMemo(() => fm.entries.filter((entry) => entry.isDir).length, [fm.entries]);
    const fileCount = fm.entries.length - folderCount;
    const totalSize = useMemo(() => fm.entries.reduce((sum, entry) => sum + (entry.size || 0), 0), [fm.entries]);

    if (!isOpen && !embedded) return null;

    const handlePull = async (entry: FileEntry) => {
        let dir = defaultDownloadDir;
        const chosen = await openDialog({ directory: true, multiple: false, defaultPath: defaultDownloadDir || undefined }).catch(() => null);
        if (typeof chosen === 'string') dir = chosen;
        if (!dir) return;
        const res = await fm.pull(entry, dir);
        if (res.success) notify(t('fileManager.pulledTitle'), t('fileManager.pulledMessage', { path: res.path || '' }), 'success');
        else notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
    };

    const handlePush = async () => {
        const chosen = await openDialog({ multiple: false }).catch(() => null);
        if (typeof chosen !== 'string') return;
        const res = await fm.push(chosen);
        if (res.success) notify(t('fileManager.pushedTitle'), t('fileManager.pushedMessage'), 'success');
        else notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
    };

    const handleDelete = (entry: FileEntry) => confirmAction(t('fileManager.deleteTitle'), t('fileManager.deleteMessage', { name: entry.name }), async () => {
        const res = await fm.remove(entry);
        if (!res.success) notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
    });

    const handleMkdir = async () => {
        const name = newFolder.trim();
        if (!name) return;
        const res = await fm.mkdir(name);
        if (res.success) {
            setNewFolder('');
            setShowNewFolder(false);
        } else notify(t('fileManager.failedTitle'), res.error || 'Unknown error', 'error');
    };

    if (embedded) {
        return <FileExplorerWorkspace fm={fm} activeDevice={activeDevice} customPath={customPath} defaultDownloadDir={defaultDownloadDir} confirmAction={confirmAction} notify={notify} />;
    }

    const crumbs = breadcrumbs(fm.cwd);
    const shellClass = embedded
        ? 'relative flex min-h-[520px] w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70 shadow-xl'
        : 'relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200';

    return (
        <div className={embedded ? 'flex min-h-[520px] w-full' : 'fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6'}>
            {!embedded && <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />}
            <div role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby={embedded ? undefined : 'file-manager-title'} className={shellClass}>
                <header className="flex items-start justify-between gap-4 border-b border-zinc-800/70 bg-gradient-to-br from-primary/[0.12] via-transparent to-transparent px-5 py-5 sm:px-7">
                    <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-lg shadow-primary/10"><FolderTree size={21} /></div>
                        <div className="min-w-0">
                            <p className="mb-1 text-[9px] font-black uppercase tracking-[0.22em] text-primary">{t('fileManager.toolLabel')}</p>
                            <h3 id="file-manager-title" className="truncate text-base font-black tracking-tight text-white sm:text-lg">{t('fileManager.title')}</h3>
                            <p className="mt-1 truncate text-[10px] text-zinc-500">{t('fileManager.subtitle')}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider sm:flex ${activeDevice ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${activeDevice ? 'bg-emerald-400' : 'bg-zinc-600'}`} />{activeDevice ? t('fileManager.deviceReady') : t('fileManager.noDevice')}</div>
                        <button onClick={fm.refresh} disabled={fm.loading || !activeDevice} title={t('common.refresh')} aria-label={t('common.refresh')} className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><RefreshCw size={16} className={fm.loading ? 'animate-spin' : ''} /></button>
                        {!embedded && <button onClick={onClose} aria-label={t('common.close')} className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"><X size={18} /></button>}
                    </div>
                </header>

                <section className="grid grid-cols-2 gap-2 border-b border-zinc-800/70 p-4 sm:grid-cols-4 sm:px-7" aria-label={t('fileManager.storageSummary')}>
                    <Metric icon={HardDrive} label={t('fileManager.currentPath')} value={fm.cwd} />
                    <Metric icon={Files} label={t('fileManager.items')} value={fm.entries.length.toString()} />
                    <Metric icon={FolderOpen} label={t('fileManager.folders')} value={folderCount.toString()} accent="primary" />
                    <Metric icon={FileIcon} label={t('fileManager.files')} value={`${fileCount} · ${formatSize(totalSize) || '0 B'}`} />
                </section>

                <section className="space-y-3 border-b border-zinc-800/70 bg-zinc-950/40 px-4 py-4 sm:px-7">
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={fm.goUp} disabled={fm.cwd === '/'} title={t('fileManager.up')} aria-label={t('fileManager.up')} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><ArrowUp size={13} /> {t('fileManager.up')}</button>
                        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-xl border border-zinc-800 bg-black/30 px-2 py-1.5 text-[10px] font-mono" aria-label={t('fileManager.pathLabel')}>
                            {crumbs.map((crumb, index) => <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">{index > 0 && <ChevronRight size={10} className="text-zinc-700" />}<button onClick={() => fm.goTo(crumb.path)} className={`rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 ${index === crumbs.length - 1 ? 'font-bold text-primary' : 'text-zinc-400'}`}>{crumb.label}</button></span>)}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={handlePush} disabled={!activeDevice || fm.busy} className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><Upload size={13} /> {t('fileManager.upload')}</button>
                        <button onClick={() => setShowNewFolder((value) => !value)} disabled={!activeDevice} className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"><FolderPlus size={13} /> {t('fileManager.newFolder')}</button>
                        {fm.busy && <span className="ml-auto flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500"><Loader2 size={13} className="animate-spin text-primary" />{t('fileManager.processing')}</span>}
                    </div>
                    {showNewFolder && <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/20 p-2"><input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder={t('fileManager.folderNamePlaceholder')} aria-label={t('fileManager.folderNamePlaceholder')} className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none" /><button onClick={handleMkdir} disabled={!newFolder.trim()} className="rounded-lg bg-primary px-3 py-2 text-[9px] font-black uppercase tracking-widest text-on-primary transition-all hover:brightness-110 disabled:opacity-30">{t('fileManager.create')}</button></div>}
                </section>

                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-7">
                        {!activeDevice ? <Empty label={t('fileManager.noDevice')} hint={t('fileManager.noDeviceHint')} />
                            : fm.loading ? <LoadingState label={t('fileManager.loading')} />
                            : fm.error ? <Empty label={t(`fileManager.errors.${fm.error}`) !== `fileManager.errors.${fm.error}` ? t(`fileManager.errors.${fm.error}`) : fm.error} />
                            : fm.entries.length === 0 ? <Empty label={t('fileManager.empty')} />
                            : <div className="space-y-2"><div className="flex items-center justify-between px-1 pb-1"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{t('fileManager.directoryContents')}</p><p className="mt-0.5 text-[9px] text-zinc-600">{t('fileManager.itemsCount', { count: fm.entries.length })}</p></div><span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-zinc-500">{fm.cwd}</span></div>
                                {fm.entries.map((entry) => {
                                    const isImage = !entry.isDir && isImageFile(entry.name);
                                    const Icon = entry.isDir ? Folder : entry.isLink ? LinkIcon : isImage ? ImageIcon : FileIcon;
                                    const interactive = entry.isDir || entry.isLink || isImage;
                                    const content = <><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${entry.isDir ? 'bg-primary/10 text-primary' : isImage ? 'bg-sky-500/10 text-sky-400' : 'bg-zinc-800/60 text-zinc-500'}`}><Icon size={16} /></span><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-200">{entry.name}</span>{entry.isLink && <span className="rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-sky-400">{t('fileManager.link')}</span>}{entry.size !== undefined && !entry.isDir && <span className="shrink-0 text-[9px] text-zinc-500">{formatSize(entry.size)}</span>} {entry.modified && <span className="hidden shrink-0 text-[9px] text-zinc-600 lg:block">{entry.modified}</span>}</>;
                                    return <div key={entry.name} className="group flex items-center gap-2 rounded-2xl border border-zinc-800/70 bg-zinc-900/35 p-2 transition-all hover:border-primary/30 hover:bg-zinc-900/70"><div className="min-w-0 flex-1">{interactive ? <button onClick={() => entry.isDir || entry.isLink ? fm.open(entry) : fm.preview(entry)} aria-label={`${entry.isDir || entry.isLink ? t('fileManager.openFolder') : t('fileManager.preview')}: ${entry.name}`} className="flex w-full min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">{content}</button> : <div className="flex min-w-0 items-center gap-2">{content}</div>}</div><div className="flex shrink-0 items-center gap-0.5"><button onClick={() => isImage ? fm.preview(entry) : handlePull(entry)} title={isImage ? t('fileManager.preview') : t('fileManager.download')} aria-label={`${isImage ? t('fileManager.preview') : t('fileManager.download')}: ${entry.name}`} className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">{isImage ? <Eye size={14} /> : <Download size={14} />}</button><button onClick={() => handleDelete(entry)} title={t('fileManager.delete')} aria-label={`${t('fileManager.delete')}: ${entry.name}`} className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"><Trash2 size={14} /></button></div></div>;
                                })}
                            </div>}
                    </div>

                    {fm.previewName && <aside className="flex max-h-80 w-full shrink-0 flex-col border-t border-zinc-800/70 bg-black/10 p-4 sm:max-h-none sm:w-72 sm:border-l sm:border-t-0 sm:p-5"><div className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-widest text-primary">{t('fileManager.preview')}</p><span className="block truncate text-[10px] text-zinc-400">{fm.previewName}</span></div><button onClick={fm.closePreview} aria-label={t('common.close')} title={t('common.close')} className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-white"><X size={14} /></button></div><div className="flex min-h-40 flex-1 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black/40">{fm.previewLoading ? <Loader2 size={20} className="animate-spin text-primary" /> : fm.previewLocalPath ? <img src={convertFileSrc(fm.previewLocalPath)} alt={fm.previewName} className="max-h-full max-w-full object-contain" /> : <span className="px-4 text-center text-[9px] font-bold uppercase tracking-widest text-amber-300">{fm.previewError || t('fileManager.previewFailed')}</span>}</div>{fm.previewLocalPath && <div className="mt-3 flex gap-2"><button onClick={() => openPath(fm.previewLocalPath!)} className="flex-1 rounded-lg border border-zinc-800 py-2 text-[8px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/50 hover:text-primary">{t('fileManager.openFile')}</button><button onClick={() => revealInFolder(fm.previewLocalPath!)} className="flex-1 rounded-lg border border-zinc-800 py-2 text-[8px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/50 hover:text-primary">{t('fileManager.openFolder')}</button></div>}</aside>}
                </div>
            </div>
        </div>
    );
}

function Metric({ icon: Icon, label, value, accent = 'neutral' }: { icon: typeof HardDrive; label: string; value: string; accent?: 'neutral' | 'primary' }) {
    return <div className="min-w-0 rounded-xl border border-zinc-800/80 bg-zinc-900/35 px-3 py-2.5"><div className="flex items-center gap-1.5"><Icon size={12} className={accent === 'primary' ? 'text-primary' : 'text-zinc-400'} /><span className="truncate text-[8px] font-black uppercase tracking-widest text-zinc-600">{label}</span></div><p className="mt-1 truncate text-[11px] font-bold text-zinc-200" title={value}>{value}</p></div>;
}

function LoadingState({ label }: { label: string }) {
    return <div className="flex flex-col items-center justify-center py-20 text-zinc-600"><Loader2 size={25} className="animate-spin text-primary" /><span className="mt-3 text-[10px] font-black uppercase tracking-[0.18em]">{label}</span></div>;
}

function Empty({ label, hint }: { label: string; hint?: string }) {
    return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60"><FolderTree size={22} /></div><span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>{hint && <span className="mt-1 max-w-sm px-6 text-center text-[10px] text-zinc-600">{hint}</span>}</div>;
}
