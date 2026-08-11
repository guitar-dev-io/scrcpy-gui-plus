export type MaestroFailureKind = 'expected' | 'maestro' | 'raw'
export type MaestroFailureSource = 'stdout' | 'stderr'

export interface MaestroFailureInput {
  stdout?: string
  stderr?: string
}

/** Structured, deliberately conservative detail extracted from Maestro output. */
export interface MaestroFailure {
  kind: MaestroFailureKind
  title: string
  message: string
  raw: string
  expected?: string
  actual?: string
  reason?: string
  source?: MaestroFailureSource
  lineNumber?: number
}

interface OutputLine {
  source: MaestroFailureSource
  lineNumber: number
  text: string
}

const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function normalizeOutput(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARACTERS, '')
    .trim()
}

function outputLines(
  source: MaestroFailureSource,
  value: unknown,
): OutputLine[] {
  const normalized = normalizeOutput(value)
  if (!normalized) return []
  return normalized.split('\n').map((text, index) => ({
    source,
    lineNumber: index + 1,
    text: text.trim(),
  }))
}

function firstMatch(
  lines: OutputLine[],
  pattern: RegExp,
): { value: string; line: OutputLine } | undefined {
  for (const line of lines) {
    const match = line.text.match(pattern)
    if (match?.[1]?.trim()) {
      return { value: match[1].trim(), line }
    }
  }
  return undefined
}

/**
 * Extracts explicit Expected/Maestro/Reason labels while leaving unknown output
 * as raw text. It accepts the two-string form used by the runner and an object
 * form that is convenient for callers holding a result object.
 */
export function parseMaestroFailure(
  stdout: string,
  stderr?: string,
): MaestroFailure | null
export function parseMaestroFailure(
  output: MaestroFailureInput,
): MaestroFailure | null
export function parseMaestroFailure(
  outputOrStdout: string | MaestroFailureInput,
  stderr = '',
): MaestroFailure | null {
  const output: MaestroFailureInput =
    typeof outputOrStdout === 'string'
      ? { stdout: outputOrStdout, stderr }
      : outputOrStdout
  const stderrText = normalizeOutput(output.stderr)
  const stdoutText = normalizeOutput(output.stdout)
  const raw = [stderrText, stdoutText].filter(Boolean).join('\n')
  if (!raw) return null

  const lines = [
    ...outputLines('stderr', stderrText),
    ...outputLines('stdout', stdoutText),
  ]
  const expectedMatch = firstMatch(
    lines,
    /(?:^|\s)expected\s*[:=]\s*(.+?)\s*$/i,
  )
  const actualMatch = firstMatch(
    lines,
    /(?:^|\s)(?:actual|received|found)\s*[:=]\s*(.+?)\s*$/i,
  )
  const reasonMatch = firstMatch(
    lines,
    /(?:^|\s)(?:maestro(?:\s*(?:error|exception|failure|reason))?|reason|failure\s+reason)\s*[:=-]\s*(.+?)\s*$/i,
  )

  if (expectedMatch) {
    const message =
      reasonMatch?.value ||
      (actualMatch
        ? `Expected ${expectedMatch.value}; received ${actualMatch.value}.`
        : `Expected ${expectedMatch.value}.`)
    const failure: MaestroFailure = {
      kind: 'expected',
      title: 'Expected condition was not met',
      message,
      raw,
      expected: expectedMatch.value,
      actual: actualMatch?.value,
      reason: reasonMatch?.value,
      source: expectedMatch.line.source,
      lineNumber: expectedMatch.line.lineNumber,
    }
    return failure
  }

  if (reasonMatch) {
    const failure: MaestroFailure = {
      kind: 'maestro',
      title: 'Maestro failure',
      message: reasonMatch.value,
      raw,
      reason: reasonMatch.value,
      actual: actualMatch?.value,
      source: reasonMatch.line.source,
      lineNumber: reasonMatch.line.lineNumber,
    }
    return failure
  }

  const firstMeaningful = lines.find((line) => line.text.length > 0)
  return {
    kind: 'raw',
    title: 'Run failed',
    message: firstMeaningful?.text || raw,
    raw,
    source: firstMeaningful?.source,
    lineNumber: firstMeaningful?.lineNumber,
  }
}

export const parseMaestroFailureOutput = parseMaestroFailure
