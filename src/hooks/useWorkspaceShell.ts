import { useCallback, useState } from 'react'
import type { StableLogEntry } from '../utils/stableLogEntries'

export interface TerminalCommandResult {
  success?: boolean
  stdout?: string
  stderr?: string
  binary?: string
  message?: unknown
}

type ExecuteTerminalCommand = (
  command: string,
  customPath?: string,
  logToSystem?: boolean,
) => Promise<TerminalCommandResult>

const MAX_SHELL_LINES = 500

function commandLabel(command: string) {
  const lower = command.trim().toLowerCase()
  const prefix = lower.startsWith('scrcpy') || lower.startsWith('adb') ? '' : 'adb '
  return `> ${prefix}${command.trim()}`
}

function resultLines(result: TerminalCommandResult): string[] {
  const lines: string[] = []
  if (result.stdout?.trim()) lines.push(...result.stdout.trim().split('\n'))
  if (result.stderr?.trim()) {
    const source = result.binary?.toUpperCase() || 'ERR'
    lines.push(...result.stderr.trim().split('\n').map((line) => `[${source}] ${line}`))
  }
  if (result.success === false && lines.length === 0 && result.message) {
    lines.push(`[ERROR] ${String(result.message)}`)
  }
  return lines
}

export function useWorkspaceShell(execute: ExecuteTerminalCommand) {
  const [entries, setEntries] = useState<StableLogEntry[]>([])

  const append = useCallback((lines: string[]) => {
    const timestamp = Date.now()
    setEntries((current) => [
      ...current,
      ...lines.map((text) => ({ text, timestamp })),
    ].slice(-MAX_SHELL_LINES))
  }, [])

  const runCommand = useCallback(async (command: string) => {
    const trimmed = command.trim()
    if (!trimmed) return
    append([commandLabel(trimmed)])
    try {
      const result = await execute(trimmed, undefined, false)
      append(resultLines(result))
    } catch (error) {
      append([`[ERROR] ${String(error)}`])
    }
  }, [append, execute])

  const clear = useCallback(() => setEntries([]), [])
  const addLog = useCallback((message: string) => append([message]), [append])
  const logs = entries.map(({ text }) => text)

  return { logs, entries, runCommand, clear, addLog }
}
