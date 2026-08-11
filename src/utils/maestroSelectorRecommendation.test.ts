import { describe, expect, it } from 'vitest'
import { recommendMaestroSelectors, bestMaestroSelector } from './maestroSelectorRecommendation'
import { parseUiHierarchy, type UiNode } from '../types/uiInspector'

const CONFIRM_PAYMENT_XML = `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" resource-id="" text="" content-desc="" clickable="false" enabled="true" focused="false" focusable="false" scrollable="false" long-clickable="false" password="false" checkable="false" checked="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" class="android.widget.Button" resource-id="com.laundryyou.washxpress.dev:id/confirm_payment" text="Confirm payment" content-desc="Confirm payment button" clickable="true" enabled="true" focused="false" focusable="true" scrollable="false" long-clickable="false" password="false" checkable="false" checked="false" selected="false" bounds="[72,1420][1008,1536]" />
    <node index="1" class="android.widget.Button" resource-id="com.laundryyou.washxpress.dev:id/cancel" text="Cancel" content-desc="" clickable="true" enabled="true" focused="false" focusable="true" scrollable="false" long-clickable="false" password="false" checkable="false" checked="false" selected="false" bounds="[72,1560][1008,1660]" />
    <node index="2" class="android.widget.Button" resource-id="" text="Cancel" content-desc="" clickable="true" enabled="true" focused="false" focusable="true" scrollable="false" long-clickable="false" password="false" checkable="false" checked="false" selected="false" bounds="[72,1700][1008,1800]" />
  </node>
</hierarchy>`

function findByText(root: UiNode, text: string): UiNode {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.text === text && node.resourceId.includes('confirm_payment')) return node
    stack.push(...node.children)
  }
  throw new Error('node not found')
}

function findDuplicateCancel(root: UiNode): UiNode {
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.text === 'Cancel' && !node.resourceId) return node
    stack.push(...node.children)
  }
  throw new Error('node not found')
}

describe('recommendMaestroSelectors', () => {
  const root = parseUiHierarchy(CONFIRM_PAYMENT_XML)
  if (!root) throw new Error('failed to parse fixture hierarchy')

  it('ranks a unique resource ID highest', () => {
    const node = findByText(root, 'Confirm payment')
    const recommendations = recommendMaestroSelectors(root, node)
    expect(recommendations[0]).toMatchObject({
      selector: { type: 'id', value: 'confirm_payment' },
      stars: 5,
    })
  })

  it('prefers ID over text/content-description/index/point', () => {
    const node = findByText(root, 'Confirm payment')
    const stars = recommendMaestroSelectors(root, node).map((r) => r.stars)
    expect(stars).toEqual([...stars].sort((a, b) => b - a))
  })

  it('always includes an index and a point fallback', () => {
    const node = findByText(root, 'Confirm payment')
    const types = recommendMaestroSelectors(root, node).map((r) => r.selector.type)
    expect(types).toContain('index')
    expect(types).toContain('point')
  })

  it('downgrades a selector that is not unique in the hierarchy', () => {
    const node = findDuplicateCancel(root)
    const textRecommendation = recommendMaestroSelectors(root, node).find(
      (r) => r.label === 'Text',
    )
    expect(textRecommendation?.stars).toBeLessThanOrEqual(2)
    expect(textRecommendation?.reason).toMatch(/not unique/i)
  })

  it('does not include an ID recommendation when the node has no resource ID', () => {
    const node = findDuplicateCancel(root)
    const idRecommendation = recommendMaestroSelectors(root, node).find((r) => r.label === 'ID')
    expect(idRecommendation).toBeUndefined()
  })

  it('bestMaestroSelector picks the top-ranked candidate', () => {
    const node = findByText(root, 'Confirm payment')
    expect(bestMaestroSelector(root, node)).toEqual({ type: 'id', value: 'confirm_payment' })
  })
})
