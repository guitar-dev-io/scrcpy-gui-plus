import type { SyntheticEvent } from 'react'

/**
 * Portal events bubble through the React tree, so a click inside a menu would
 * reach an onClick on the card that owns the trigger. Stop them at the layer.
 */
export const stopBubble = (event: SyntheticEvent) => event.stopPropagation()

export const DEFAULT_TRIGGER_CLASS =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-surface)] px-2 text-[var(--font-size-label)] text-[var(--text-muted)] transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-40'

export const FLOATING_PANEL_CLASS =
  'rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-base)] shadow-[var(--shadow-lg)]'

/** Index of the next enabled entry from `from` in `step` direction, wrapping. -1 if none. */
export function nextEnabledIndex(
  disabled: boolean[],
  from: number,
  step: 1 | -1,
): number {
  const count = disabled.length
  if (count === 0) return -1
  for (let i = 1; i <= count; i += 1) {
    const index = (((from + step * i) % count) + count) % count
    if (!disabled[index]) return index
  }
  return -1
}

/** First enabled entry whose text starts with `query`, searching from `from` (inclusive) with wrap. */
export function findTypeahead(
  texts: string[],
  disabled: boolean[],
  query: string,
  from: number,
): number {
  const needle = query.toLowerCase()
  const count = texts.length
  for (let i = 0; i < count; i += 1) {
    const index = (from + i) % count
    if (!disabled[index] && texts[index].toLowerCase().startsWith(needle)) return index
  }
  return -1
}
