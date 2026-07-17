import { X, AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import React from 'react';

type ModalKind = 'warning' | 'error' | 'info' | 'success';

interface ThemedModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    message: string;
    kind?: ModalKind;
    actionLabel?: string;
    onAction?: () => void;
    showCancel?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
}

export default function ThemedModal({
    isOpen,
    onClose,
    title,
    message,
    kind = 'info',
    actionLabel = 'OK',
    onAction,
    showCancel = false,
    cancelLabel = 'Cancel',
    onCancel
}: ThemedModalProps) {
    if (!isOpen) return null;

    const config = {
        warning: {
            icon: <AlertTriangle size={32} className="text-amber-400" />,
            border: 'border-amber-500/30',
            bg: 'bg-amber-500/5',
            glow: 'from-amber-500/20'
        },
        error: {
            icon: <AlertCircle size={32} className="text-red-400" />,
            border: 'border-red-500/30',
            bg: 'bg-red-500/5',
            glow: 'from-red-500/20'
        },
        info: {
            icon: <Info size={32} className="text-primary" />,
            border: 'border-primary/30',
            bg: 'bg-primary/5',
            glow: 'from-primary/20'
        },
        success: {
            icon: <CheckCircle2 size={32} className="text-emerald-400" />,
            border: 'border-emerald-500/30',
            bg: 'bg-emerald-500/5',
            glow: 'from-emerald-500/20'
        }
    };

    const current = config[kind];

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-6 sm:p-8"
            onClick={handleBackdropClick}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"></div>

            {/* Modal Container */}
            <div className={`relative w-full max-w-md bg-zinc-950/90 border ${current.border} rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] overflow-hidden animate-in zoom-in-95 fade-in duration-300 flex flex-col backdrop-blur-2xl`}>

                {/* Decorative Glow */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-radial-gradient from-current via-transparent to-transparent opacity-20 blur-3xl pointer-events-none`}></div>
                <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-current to-transparent opacity-40`} style={{ color: 'var(--primary)' }}></div>

                {/* Close Button */}
                <div className="absolute top-4 right-4 z-10">
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all active:scale-90"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 pb-6 flex flex-col items-center text-center pt-12">
                    {/* Icon */}
                    <div className={`w-16 h-16 rounded-2xl ${current.bg} border ${current.border} flex items-center justify-center mb-6 shadow-lg shadow-black/20`}>
                        {current.icon}
                    </div>

                    {/* Content */}
                    <h3 className="text-xl font-black italic uppercase tracking-tighter text-white mb-3">
                        {title}
                    </h3>
                    <p className="text-zinc-400 text-sm font-medium leading-relaxed max-w-[280px]">
                        {message}
                    </p>
                </div>

                {/* Footer Actions */}
                <div className="p-4 pt-0 flex gap-3">
                    {showCancel && (
                        <button
                            onClick={() => {
                                if (onCancel) onCancel();
                                onClose();
                            }}
                            className="flex-1 py-4 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] hover:text-white active:scale-95"
                        >
                            {cancelLabel}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            if (onAction) onAction();
                            onClose();
                        }}
                        className={`${showCancel ? 'flex-1' : 'w-full'} py-4 bg-primary text-on-primary rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-95 shadow-[0_10px_30px_-5px_rgba(139,92,246,0.3)]`}
                    >
                        {actionLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
