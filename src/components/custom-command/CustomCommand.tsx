import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    X,
    SquareTerminal,
    Play,
    Plus,
    Trash2,
    Pencil,
    Download,
    Upload,
    Loader2,
    CheckCircle2,
    XCircle
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useCustomCommands } from '../../hooks/useCustomCommands';
import type { CommandPreset } from '../../types/customCommand';
import type { ToolbarNotifier } from '../device-control-toolbar';

interface CustomCommandProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    packageName?: string;
    customPath?: string;
    notify: ToolbarNotifier;
}

const emptyDraft = (): CommandPreset => ({ id: '', label: '', template: '' });

export default function CustomCommand({
    isOpen,
    onClose,
    activeDevice,
    packageName,
    customPath,
    notify
}: CustomCommandProps) {
    const { t } = useI18n();
    const cmds = useCustomCommands({ activeDevice, packageName, customPath });
    const [draft, setDraft] = useState<CommandPreset | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [importText, setImportText] = useState('');

    if (!isOpen) return null;

    const startAdd = () => setDraft(emptyDraft());
    const startEdit = (p: CommandPreset) => setDraft({ ...p });

    const saveDraft = () => {
        if (!draft) return;
        const label = draft.label.trim();
        const template = draft.template.trim();
        if (!label || !template) return;
        const id = draft.id || `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        cmds.upsert({
            id,
            label,
            template,
            needsPackage: template.includes('{package}')
        });
        setDraft(null);
    };

    const handleRun = async (preset: CommandPreset) => {
        const res = await cmds.run(preset);
        if (res.success) {
            notify(t('customCmd.ranTitle'), t('customCmd.ranMessage', { label: preset.label }), 'success');
        } else if (res.errorCode !== 'no_device') {
            const key = res.errorCode ? `customCmd.errors.${res.errorCode}` : '';
            const localized = key ? t(key) : '';
            const message =
                (localized && localized !== key ? localized : '') ||
                res.stderr ||
                res.error ||
                'Unknown error';
            notify(t('customCmd.failedTitle'), message, 'error');
        }
    };

    const handleExport = async () => {
        try {
            const content = cmds.exportJson();
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const path = await invoke<string>('save_report', {
                content,
                name: `custom-commands_${ts}.json`
            });
            notify(t('customCmd.exportedTitle'), t('customCmd.exportedMessage', { path }), 'success');
        } catch (e) {
            notify(t('customCmd.failedTitle'), String(e), 'error');
        }
    };

    const handleImport = () => {
        if (cmds.importJson(importText)) {
            setImportText('');
            setShowImport(false);
            notify(t('customCmd.importedTitle'), t('customCmd.importedMessage'), 'success');
        } else {
            notify(t('customCmd.failedTitle'), t('customCmd.importInvalid'), 'error');
        }
    };

    const inputCls =
        'w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[12px] text-zinc-200 focus:border-primary/40 focus:outline-none';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <SquareTerminal size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('customCmd.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('customCmd.noDevice')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={handleExport} title={t('customCmd.export')} className="p-2 rounded-xl text-zinc-500 hover:text-primary hover:bg-white/5 transition-all">
                            <Download size={16} />
                        </button>
                        <button onClick={() => setShowImport((s) => !s)} title={t('customCmd.import')} className="p-2 rounded-xl text-zinc-500 hover:text-primary hover:bg-white/5 transition-all">
                            <Upload size={16} />
                        </button>
                        <button onClick={onClose} className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-3">
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                        <p className="text-[10px] text-zinc-400 leading-relaxed">
                            {t('customCmd.help')}
                        </p>
                    </div>

                    {showImport && (
                        <div className="space-y-2">
                            <textarea
                                value={importText}
                                onChange={(e) => setImportText(e.target.value)}
                                placeholder={t('customCmd.importPlaceholder')}
                                rows={4}
                                className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-200 focus:border-primary/40 focus:outline-none resize-none"
                            />
                            <button onClick={handleImport} className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all">
                                {t('customCmd.importApply')}
                            </button>
                        </div>
                    )}

                    {/* Command list */}
                    {cmds.presets.map((p) => {
                        const running = cmds.runningId === p.id;
                        const result = cmds.lastResult?.id === p.id ? cmds.lastResult.result : null;
                        return (
                            <div key={p.id} className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 overflow-hidden">
                                <div className="flex items-center gap-2 p-2.5">
                                    <button
                                        onClick={() => void handleRun(p)}
                                        disabled={!activeDevice || running}
                                        title={t('customCmd.run')}
                                        className="p-1.5 rounded-md bg-primary text-on-primary hover:brightness-110 transition-all disabled:opacity-30"
                                    >
                                        {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-bold text-zinc-200 truncate">{p.label}</p>
                                        <p className="text-[9px] text-zinc-500 font-mono truncate">
                                            adb {p.template}
                                        </p>
                                    </div>
                                    {result &&
                                        (result.success ? (
                                            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                                        ) : (
                                            <XCircle size={13} className="text-red-400 shrink-0" />
                                        ))}
                                    <button onClick={() => startEdit(p)} className="p-1 rounded text-zinc-600 hover:text-primary transition-colors">
                                        <Pencil size={12} />
                                    </button>
                                    <button onClick={() => cmds.remove(p.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                                {result && (result.stdout || result.stderr) && (
                                    <pre className="text-[9px] font-mono text-zinc-400 bg-black/40 px-3 py-2 max-h-28 overflow-y-auto custom-scrollbar whitespace-pre-wrap border-t border-zinc-800/60">
                                        {(result.stdout || '') + (result.stderr || '')}
                                    </pre>
                                )}
                            </div>
                        );
                    })}

                    {/* Add / edit form */}
                    {draft ? (
                        <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
                            <input
                                className={inputCls}
                                placeholder={t('customCmd.labelPlaceholder')}
                                value={draft.label}
                                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                            />
                            <input
                                className={`${inputCls} font-mono`}
                                placeholder={t('customCmd.templatePlaceholder')}
                                value={draft.template}
                                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setDraft(null)}
                                    className="flex-1 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:text-white transition-all"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={saveDraft}
                                    disabled={!draft.label.trim() || !draft.template.trim()}
                                    className="flex-1 py-2 rounded-lg bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30"
                                >
                                    {t('customCmd.saveCommand')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={startAdd}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:border-primary/50 hover:text-primary transition-all"
                        >
                            <Plus size={13} /> {t('customCmd.addCommand')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
