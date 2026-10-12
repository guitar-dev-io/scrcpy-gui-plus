import { describe, expect, it } from 'vitest'
import css from '../../../index.css?raw'

function tokenValue(name: string): number {
  const match = css.match(new RegExp(`${name}:\\s*(\\d+)\\s*;`))
  if (!match) throw new Error(`${name} not found in index.css`)
  return Number(match[1])
}

describe('--z-layer-* tokens', () => {
  it('are strictly ordered base < sticky-nav < dropdown < popover < tooltip < drawer < dialog < critical', () => {
    const order = [
      '--z-layer-base',
      '--z-layer-sticky-nav',
      '--z-layer-dropdown',
      '--z-layer-popover',
      '--z-layer-tooltip',
      '--z-layer-drawer-backdrop',
      '--z-layer-drawer',
      '--z-layer-dialog-backdrop',
      '--z-layer-dialog',
      '--z-layer-critical',
    ].map(tokenValue)
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }
    expect(tokenValue('--z-layer-raised')).toBeGreaterThan(tokenValue('--z-layer-base'))
    expect(tokenValue('--z-layer-raised')).toBeLessThan(tokenValue('--z-layer-sticky-nav'))
  })

  it('leaves the existing layer tokens unchanged', () => {
    expect(tokenValue('--z-sidebar')).toBe(30)
    expect(tokenValue('--z-topbar')).toBe(40)
    expect(tokenValue('--z-drawer')).toBe(80)
    expect(tokenValue('--z-modal')).toBe(300)
  })
})
