import { describe, expect, it } from 'vitest'

// getRecordSvg() in src/services/qrStudioService.ts is the ONLY accessor of a record's SVG.
// Property access (`record.svg`, `x.svg)`) is forbidden in qr-studio components. Filename
// literals such as 'x.svg' or `${name}.svg` are fine and excluded by the lookahead.
const SVG_PROPERTY_ACCESS = /\.svg\b(?!['"`])/

/** Explicit allowlist of `relative/path.ts:line` entries. Keep empty. */
const ALLOWLIST: readonly string[] = []

// Every non-test .ts/.tsx source under src/components/qr-studio, loaded as raw text by Vite.
const SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('record svg access', () => {
  it('matches property access but not filename literals', () => {
    expect(SVG_PROPERTY_ACCESS.test('record.svg')).toBe(true)
    expect(SVG_PROPERTY_ACCESS.test('foo(record.svg)')).toBe(true)
    expect(SVG_PROPERTY_ACCESS.test("download('x.svg')")).toBe(false)
    expect(SVG_PROPERTY_ACCESS.test('`${name}.svg`')).toBe(false)
  })

  it('no qr-studio component reads a record svg directly', () => {
    const offenders: string[] = []
    expect(Object.keys(SOURCES)).toContain('./useQrStore.ts')
    for (const [file, source] of Object.entries(SOURCES)) {
      source.split('\n').forEach((line, index) => {
        if (!SVG_PROPERTY_ACCESS.test(line)) return
        const key = `${file.slice(2)}:${index + 1}`
        if (!ALLOWLIST.includes(key)) offenders.push(`${key}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
