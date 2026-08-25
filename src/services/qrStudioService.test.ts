import { describe, expect, it } from 'vitest'
import { parseMultiQrInput, qrFileName, styleQrSvg } from './qrStudioService'

describe('qrStudioService', () => {
  it('parses named and unnamed multi-create rows', () => {
    expect(parseMultiQrInput('Website | https://example.com\nhello world\n')).toEqual([
      { name: 'Website', content: 'https://example.com' },
      { name: 'QR Code 2', content: 'hello world' },
    ])
  })

  it('applies export colors and dimensions to generated SVG', () => {
    const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'
    expect(styleQrSvg(svg, { foreground: '#000000', background: '#ffffff', size: 512, errorCorrection: 'M' }))
      .toBe('<svg width="512" height="512"><path fill="#000000"/><path fill="#ffffff"/></svg>')
  })

  it('creates safe download names', () => {
    expect(qrFileName(' Product launch / 2026 ', 'svg')).toBe('product-launch-2026.svg')
  })
})
