import { describe, expect, it } from 'vitest'

// Light themes remap Tailwind `.text-white` / `.text-zinc-*` to dark text, but QR Studio panels
// stay navy in every theme. Components must use the local --qr-* text tokens instead.
const REMAPPED_TEXT = /(?<![\w-])(?:hover:|focus:|group-hover:)?text-(?:white|zinc-\d+)(?![\w-])/

const SOURCES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('qr-studio text tokens', () => {
  it('matches the remapped utilities but not token classes', () => {
    expect(REMAPPED_TEXT.test('text-white')).toBe(true)
    expect(REMAPPED_TEXT.test('x hover:text-white y')).toBe(true)
    expect(REMAPPED_TEXT.test('text-zinc-300')).toBe(true)
    expect(REMAPPED_TEXT.test('text-[color:var(--qr-text)]')).toBe(false)
    expect(REMAPPED_TEXT.test('text-slate-200')).toBe(false)
  })

  it('no qr-studio component uses text-white or text-zinc-*', () => {
    const offenders: string[] = []
    expect(Object.keys(SOURCES)).toContain('./formControls.tsx')
    for (const [file, source] of Object.entries(SOURCES)) {
      source.split('\n').forEach((line, index) => {
        if (REMAPPED_TEXT.test(line)) offenders.push(`${file.slice(2)}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
