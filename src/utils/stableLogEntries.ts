export interface StableLogEntry {
  text: string
  timestamp: number
}

/**
 * Reuses timestamps for retained log lines while assigning a timestamp only
 * when a line first enters the bounded log buffer.
 */
export function reconcileStableLogEntries(
  previous: readonly StableLogEntry[],
  logs: readonly string[],
  timestamp = Date.now(),
): StableLogEntry[] {
  const maxOverlap = Math.min(previous.length, logs.length)
  let overlap = maxOverlap

  while (overlap > 0) {
    const previousOffset = previous.length - overlap
    let matches = true
    for (let index = 0; index < overlap; index += 1) {
      if (previous[previousOffset + index]?.text !== logs[index]) {
        matches = false
        break
      }
    }
    if (matches) break
    overlap -= 1
  }

  const retained = overlap > 0 ? previous.slice(previous.length - overlap) : []
  const added = logs.slice(overlap).map((text) => ({ text, timestamp }))
  return [...retained, ...added]
}
