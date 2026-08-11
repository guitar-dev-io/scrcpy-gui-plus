export type MaestroFailureKind = 'expected' | 'maestro' | 'raw'

export interface MaestroFailure {
  kind: MaestroFailureKind
  title: string
  expected?: string
  actual?: string
  message: string
  raw: string
}

/** Extracts useful failure detail without depending on one Maestro CLI version. */
export function parseMaestroFailure(stdout: string, stderr: string): MaestroFailure | null {
  const raw = [stderr, stdout].map((value) => value.trim()).filter(Boolean).join('\n')
  if (!raw) return null

  const expected = raw.match(/expected\s*[:=]\s*([^\n]+)/i)?.[1]?.trim()
  const actual = raw.match(/actual\s*[:=]\s*([^\n]+)/i)?.[1]?.trim()
  if (expected) {
    return {
      kind: 'expected',
      title: 'Expected condition was not met',
      expected,
      actual,
      message: actual ? `Expected ${expected}; received ${actual}.` : `Expected ${expected}.`,
      raw,
    }
  }

  const maestro = raw.match(/(?:maestro(?: exception| error)?|error|failure|failed)\s*[:\-]\s*([^\n]+)/i)
  if (maestro?.[1]) {
    return { kind: 'maestro', title: 'Maestro failure', message: maestro[1].trim(), raw }
  }

  const firstMeaningful = raw.split('\n').map((line) => line.trim()).find(Boolean) ?? raw
  return { kind: 'raw', title: 'Run failed', message: firstMeaningful, raw }
}
