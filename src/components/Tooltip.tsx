import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';

interface TooltipProps {
    text: string;
    children?: React.ReactNode;
    placement?: 'top' | 'bottom';
}

export default function Tooltip({ text, children, placement = 'top' }: TooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const tooltipId = useId();

    return (
        <div
            className="relative inline-flex items-center"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {/* Focus events bubble, so a wrapped control (children) shows the
                tooltip on keyboard focus without adding a second tab stop. */}
            <span
                tabIndex={children ? undefined : 0}
                aria-label={children ? undefined : text}
                aria-describedby={isVisible ? tooltipId : undefined}
                onFocus={() => setIsVisible(true)}
                onBlur={() => setIsVisible(false)}
                className={children
                    ? 'text-[10px] font-bold text-primary cursor-help transition-colors hover:text-white'
                    : 'inline-flex cursor-help items-center rounded text-[var(--text-subtle)] transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'}
            >
                {children || <Info size={12} aria-hidden="true" />}
            </span>

            {isVisible && (
                <div id={tooltipId} role="tooltip" className={`absolute left-1/2 -translate-x-1/2 w-48 p-2 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl z-[100] text-center backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200 ${placement === 'top'
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
