import { useCallback, useMemo, useRef, useState } from 'react';
import {
    X,
    ScanSearch,
    RefreshCw,
    Loader2,
    Smartphone,
    Copy,
    Check,
    ChevronRight,
    MousePointerSquareDashed,
    Search
} from 'lucide-react';
import { useI18n } from '../../i18n';
import { useUiInspector } from '../../hooks/useUiInspector';
import { nodeAtPoint, shortClassName, type UiNode } from '../../types/uiInspector';

interface UiInspectorProps {
    isOpen: boolean;
    onClose: () => void;
    activeDevice: string;
    customPath?: string;
}

interface CopyRowProps {
    label: string;
    value: string;
    onCopy: (value: string, key: string) => void;
    copiedKey: string | null;
    copyKey: string;
    mono?: boolean;
}

function CopyRow({ label, value, onCopy, copiedKey, copyKey, mono }: CopyRowProps) {
    if (!value) return null;
    const copied = copiedKey === copyKey;
    return (
        <div className="flex items-start gap-2 py-1.5 border-b border-zinc-800/50">
            <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest w-20 shrink-0 pt-0.5">
                {label}
            </span>
            <span
                className={`flex-1 text-[11px] text-zinc-200 break-all ${mono ? 'font-mono' : ''}`}
            >
                {value}
            </span>
            <button
                onClick={() => onCopy(value, copyKey)}
                className="p-1 rounded text-zinc-500 hover:text-primary transition-colors shrink-0"
                title="Copy"
            >
                {copied ? (
                    <Check size={12} className="text-emerald-400" />
                ) : (
                    <Copy size={12} />
                )}
            </button>
        </div>
    );
}

function BoolBadge({ label, value }: { label: string; value: boolean }) {
    return (
        <span
            className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                value
                    ? 'bg-primary/20 text-primary'
                    : 'bg-zinc-800/60 text-zinc-600'
            }`}
        >
            {label}
        </span>
    );
}

/** Recursive tree row. */
function TreeRow({
    node,
    selectedId,
    onSelect,
    query
}: {
    node: UiNode;
    selectedId: number | null;
    onSelect: (n: UiNode) => void;
    query: string;
}) {
    const [open, setOpen] = useState(node.depth < 2);
    const hasChildren = node.children.length > 0;

    const label = shortClassName(node.className);
    const matches =
        !query ||
        node.className.toLowerCase().includes(query) ||
        node.resourceId.toLowerCase().includes(query) ||
        node.text.toLowerCase().includes(query) ||
        node.contentDesc.toLowerCase().includes(query);

    // Keep ancestors of matches visible.
    const childMatch = useMemo(() => {
        if (!query) return true;
        const stack = [...node.children];
        while (stack.length) {
            const n = stack.pop()!;
            if (
                n.className.toLowerCase().includes(query) ||
                n.resourceId.toLowerCase().includes(query) ||
                n.text.toLowerCase().includes(query) ||
                n.contentDesc.toLowerCase().includes(query)
            ) {
                return true;
            }
            stack.push(...n.children);
        }
        return false;
    }, [node, query]);

    if (query && !matches && !childMatch) return null;

    const idLabel = node.resourceId
        ? node.resourceId.split('/').pop()
        : node.text || node.contentDesc;

    return (
        <div>
            <div
                className={`flex items-center gap-1 rounded-md pr-2 cursor-pointer transition-colors ${
                    selectedId === node.id
                        ? 'bg-primary/20 text-primary'
                        : 'text-zinc-400 hover:bg-white/5'
                }`}
                style={{ paddingLeft: `${node.depth * 10 + 2}px` }}
                onClick={() => onSelect(node)}
            >
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen((o) => !o);
                    }}
                    className={`p-0.5 shrink-0 ${hasChildren ? '' : 'opacity-0 pointer-events-none'}`}
                >
                    <ChevronRight
                        size={11}
                        className={`transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                </button>
                <span className="text-[10px] font-semibold truncate py-1">
                    {label}
                    {idLabel && (
                        <span className="text-zinc-600 font-normal"> · {idLabel}</span>
                    )}
                </span>
            </div>
            {open &&
                hasChildren &&
                node.children.map((c) => (
                    <TreeRow
                        key={c.id}
                        node={c}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        query={query}
                    />
                ))}
        </div>
    );
}

export default function UiInspector({
    isOpen,
    onClose,
    activeDevice,
    customPath
}: UiInspectorProps) {
    const { t } = useI18n();
    const { root, screenshot, selected, setSelected, loading, error, refresh } = useUiInspector({
        activeDevice,
        customPath,
        enabled: isOpen
    });

    const imgRef = useRef<HTMLImageElement | null>(null);
    const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [natural, setNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
    const [hovered, setHovered] = useState<UiNode | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    const scale = natural.w > 0 ? imgSize.w / natural.w : 1;

    const handleImgLoad = useCallback(() => {
        const el = imgRef.current;
        if (!el) return;
        setNatural({ w: el.naturalWidth, h: el.naturalHeight });
        setImgSize({ w: el.clientWidth, h: el.clientHeight });
    }, []);

    // Translate a pointer event to device pixels and select/hover the node there.
    const pointToNode = useCallback(
        (e: React.MouseEvent): UiNode | null => {
            const el = imgRef.current;
            if (!el || !root || natural.w === 0) return null;
            const rect = el.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            const deviceX = relX * natural.w;
            const deviceY = relY * natural.h;
            return nodeAtPoint(root, deviceX, deviceY);
        },
        [root, natural]
    );

    const copy = useCallback((value: string, key: string) => {
        navigator.clipboard
            .writeText(value)
            .then(() => {
                setCopiedKey(key);
                setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
            })
            .catch(() => undefined);
    }, []);

    if (!isOpen) return null;

    const rect = (n: UiNode | null) =>
        n
            ? {
                  left: n.bounds.x * scale,
                  top: n.bounds.y * scale,
                  width: n.bounds.width * scale,
                  height: n.bounds.height * scale
              }
            : null;

    const selectedRect = rect(selected);
    const hoveredRect = rect(hovered);

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
                    <div className="flex items-center gap-2">
                        <ScanSearch size={18} className="text-primary" />
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                {t('uiInspector.title')}
                            </h3>
                            <p className="text-[9px] text-zinc-500 tracking-wide">
                                {activeDevice || t('uiInspector.noDevice')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => void refresh()}
                            disabled={!activeDevice || loading}
                            title={t('uiInspector.refresh')}
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

                {/* Body */}
                {!activeDevice ? (
                    <div className="flex flex-col items-center justify-center py-24 text-zinc-700">
                        <Smartphone size={22} />
                        <span className="text-[10px] uppercase tracking-widest mt-2">
                            {t('uiInspector.noDevice')}
                        </span>
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
                        {/* Screenshot + overlay */}
                        <div className="lg:w-[42%] shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-800/60 p-4 flex items-center justify-center bg-black/30 min-h-0">
                            {loading && !screenshot ? (
                                <div className="flex flex-col items-center justify-center text-zinc-600 py-20">
                                    <Loader2 size={22} className="animate-spin" />
                                    <span className="text-[10px] uppercase tracking-widest mt-2">
                                        {t('uiInspector.loading')}
                                    </span>
                                </div>
                            ) : screenshot ? (
                                <div className="relative inline-block max-h-[70vh]">
                                    <img
                                        ref={imgRef}
                                        src={screenshot}
                                        alt="device screen"
                                        onLoad={handleImgLoad}
                                        className="max-h-[70vh] w-auto rounded-xl border border-zinc-800 select-none"
                                        draggable={false}
                                    />
                                    {/* Interaction layer */}
                                    <div
                                        className="absolute inset-0 cursor-crosshair"
                                        onMouseMove={(e) => setHovered(pointToNode(e))}
                                        onMouseLeave={() => setHovered(null)}
                                        onClick={(e) => {
                                            const n = pointToNode(e);
                                            if (n) setSelected(n);
                                        }}
                                    >
                                        {hoveredRect && hovered?.id !== selected?.id && (
                                            <div
                                                className="absolute border border-sky-400/70 bg-sky-400/10 pointer-events-none"
                                                style={hoveredRect}
                                            />
                                        )}
                                        {selectedRect && (
                                            <div
                                                className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
                                                style={selectedRect}
                                            />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-zinc-600 py-20 px-4 text-center">
                                    <MousePointerSquareDashed size={22} />
                                    <span className="text-[10px] uppercase tracking-widest mt-2">
                                        {error
                                            ? t(`uiInspector.errors.${error.code}`) !==
                                              `uiInspector.errors.${error.code}`
                                                ? t(`uiInspector.errors.${error.code}`)
                                                : error.message
                                            : t('uiInspector.noData')}
                                    </span>
                                    <button
                                        onClick={() => void refresh()}
                                        className="mt-3 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-primary text-on-primary hover:brightness-110"
                                    >
                                        {t('uiInspector.refresh')}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Tree + attributes */}
                        <div className="flex-1 min-h-0 flex flex-col">
                            {/* Attributes panel */}
                            <div className="p-4 border-b border-zinc-800/60 max-h-[46%] overflow-y-auto custom-scrollbar">
                                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                                    {t('uiInspector.attributes')}
                                </span>
                                {selected ? (
                                    <div className="mt-2">
                                        <div className="flex flex-wrap gap-1 mb-2">
                                            {selected.clickable && (
                                                <BoolBadge label={t('uiInspector.clickable')} value />
                                            )}
                                            {selected.scrollable && (
                                                <BoolBadge label={t('uiInspector.scrollable')} value />
                                            )}
                                            {selected.checkable && (
                                                <BoolBadge
                                                    label={t('uiInspector.checked')}
                                                    value={selected.checked}
                                                />
                                            )}
                                            {selected.focused && (
                                                <BoolBadge label={t('uiInspector.focused')} value />
                                            )}
                                            {selected.password && (
                                                <BoolBadge label={t('uiInspector.password')} value />
                                            )}
                                            <BoolBadge
                                                label={t('uiInspector.enabled')}
                                                value={selected.enabled}
                                            />
                                        </div>
                                        <CopyRow
                                            label={t('uiInspector.class')}
                                            value={selected.className}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="class"
                                            mono
                                        />
                                        <CopyRow
                                            label={t('uiInspector.resourceId')}
                                            value={selected.resourceId}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="resourceId"
                                            mono
                                        />
                                        <CopyRow
                                            label={t('uiInspector.text')}
                                            value={selected.text}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="text"
                                        />
                                        <CopyRow
                                            label={t('uiInspector.contentDesc')}
                                            value={selected.contentDesc}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="contentDesc"
                                        />
                                        <CopyRow
                                            label={t('uiInspector.package')}
                                            value={selected.packageName}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="package"
                                            mono
                                        />
                                        <CopyRow
                                            label={t('uiInspector.bounds')}
                                            value={`[${selected.bounds.x},${selected.bounds.y}][${
                                                selected.bounds.x + selected.bounds.width
                                            },${selected.bounds.y + selected.bounds.height}]`}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="bounds"
                                            mono
                                        />
                                        <CopyRow
                                            label={t('uiInspector.xpath')}
                                            value={selected.xpath}
                                            onCopy={copy}
                                            copiedKey={copiedKey}
                                            copyKey="xpath"
                                            mono
                                        />
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-zinc-600 mt-2">
                                        {t('uiInspector.selectHint')}
                                    </p>
                                )}
                            </div>

                            {/* Tree */}
                            <div className="flex-1 min-h-0 flex flex-col p-3">
                                <div className="relative mb-2">
                                    <Search
                                        size={12}
                                        className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600"
                                    />
                                    <input
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value.toLowerCase())}
                                        placeholder={t('uiInspector.searchPlaceholder')}
                                        className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
                                    />
                                </div>
                                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                                    {root ? (
                                        <TreeRow
                                            node={root}
                                            selectedId={selected?.id ?? null}
                                            onSelect={setSelected}
                                            query={query}
                                        />
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-10 text-zinc-700">
                                            <span className="text-[9px] uppercase tracking-widest">
                                                {t('uiInspector.noData')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
