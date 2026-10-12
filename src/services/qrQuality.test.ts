import { describe, expect, it } from 'vitest'
import { assessQrQuality, colorContrast, type QrQualityInput } from './qrQuality'

const base: QrQualityInput = {
  content: 'https://example.com',
  foreground: '#000000',
  background: '#ffffff',
  size: 1024,
  errorCorrection: 'M',
}
const codes = (input: Partial<QrQualityInput>) => assessQrQuality({ ...base, ...input }).issues.map((i) => i.code)

describe('qrQuality', () => {
  it('computes WCAG contrast', () => {
    expect(colorContrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(colorContrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('reports ok for a good code', () => {
    expect(assessQrQuality(base)).toEqual({ level: 'ok', issues: [] })
  })

  it('warns below 3:1 and errors below 2:1', () => {
    const warn = assessQrQuality({ ...base, foreground: '#888888', background: '#ffffff' })
    expect(colorContrast('#888888', '#ffffff')).toBeGreaterThan(3)
    expect(warn.level).toBe('ok')
    const low = assessQrQuality({ ...base, foreground: '#aaaaaa', background: '#ffffff' })
    expect(colorContrast('#aaaaaa', '#ffffff')).toBeLessThan(3)
    expect(colorContrast('#aaaaaa', '#ffffff')).toBeGreaterThan(2)
    expect(low.level).toBe('warn')
    expect(low.issues.map((i) => i.code)).toEqual(['contrast-low'])
    const critical = assessQrQuality({ ...base, foreground: '#dddddd', background: '#ffffff' })
    expect(critical.level).toBe('error')
    expect(critical.issues.map((i) => i.code)).toContain('contrast-critical')
  })

  it('warns when the code is lighter than its background (inverted)', () => {
    const report = assessQrQuality({ ...base, foreground: '#ffffff', background: '#000000' })
    expect(report.level).toBe('warn')
    expect(report.issues.map((i) => i.code)).toEqual(['inverted'])
  })

  it('errors on invalid colors', () => {
    expect(assessQrQuality({ ...base, foreground: 'red' }).level).toBe('error')
  })

  it('warns for sizes under 256', () => {
    expect(codes({ size: 255 })).toEqual(['size-small'])
    expect(codes({ size: 256 })).toEqual([])
  })

  it('warns for EC L when content is over 60% of capacity', () => {
    expect(codes({ errorCorrection: 'L', content: 'a'.repeat(1773) })).toEqual(['ec-low-dense', 'content-long'])
    expect(codes({ errorCorrection: 'L', content: 'a'.repeat(1773) })).not.toContain('capacity-exceeded')
    expect(codes({ errorCorrection: 'L', content: 'a'.repeat(1700) })).toEqual(['content-long'])
    expect(codes({ errorCorrection: 'M', content: 'a'.repeat(1773) })).toEqual(['content-long'])
  })

  it('errors on empty or over-capacity content', () => {
    expect(assessQrQuality({ ...base, content: '  ' }).level).toBe('error')
    const over = assessQrQuality({ ...base, errorCorrection: 'H', content: 'a'.repeat(1274) })
    expect(over.level).toBe('error')
    expect(over.issues.map((i) => i.code)).toEqual(['capacity-exceeded'])
  })

  it('maps round-trip results: verified ok, mismatch error, undecodable warn', () => {
    expect(assessQrQuality({ ...base, roundTrip: 'verified' }).level).toBe('ok')
    expect(assessQrQuality({ ...base, roundTrip: 'mismatch' }).level).toBe('error')
    expect(assessQrQuality({ ...base, roundTrip: 'undecodable' }).level).toBe('warn')
    expect(assessQrQuality({ ...base, roundTrip: null }).level).toBe('ok')
  })
})
