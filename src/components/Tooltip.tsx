import React, { useState } from 'react';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
    placement?: 'top' | 'bottom';
}

export default function Tooltip({ text, children, placement = 'top' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div
            className="relative inline-flex items-center"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            <span className="text-[10px] font-bold text-primary cursor-help transition-colors hover:text-white">
                {children || "(?)"}
            </span>

            {isVisible && (
                <div className={`absolute left-1/2 -translate-x-1/2 w-48 p-2 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl z-[100] text-center backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200 ${placement === 'top'
                        ? 'bottom-full mb-2'
                        : 'top-full mt-2'
                    }`}>
                    <p className="text-[10px] text-zinc-300 leading-tight">{text}</p>
                    {/* Arrow */}
                    <div className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${placement === 'top'
                            ? 'top-full -mt-1 border-t-zinc-700/50'
                            : 'bottom-full -mb-1 border-b-zinc-700/50'
                        }`}></div>
                </div>
            )}
        </div>
    );
}
