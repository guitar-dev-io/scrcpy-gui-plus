import { describe, expect, it } from 'vitest'
import { parseUiHierarchy } from '../types/uiInspector'
import { matchSmartElement, selectorAtPoint } from './smartElementBroadcast'

const xml = (nodes: string) => `<hierarchy>${nodes}</hierarchy>`
const node = (attrs: string, children = '') => {
  const bounds = attrs.includes('bounds=') ? '' : 'bounds="[0,0][200,100]"'
  return `<node index="0" class="android.widget.Button" package="app" clickable="true" enabled="true" ${bounds} ${attrs}>${children}</node>`
}

describe('smart element broadcast matching', () => {
  it('captures the smallest identifiable master node at the tap point', () => {
    const root = parseUiHierarchy(xml(node('resource-id="parent" text="" content-desc=""',
      node('resource-id="child" text="Continue" content-desc="Next" bounds="[20,20][120,80]"'),
    )))!
    expect(selectorAtPoint(root, 50, 50)).toMatchObject({
      resourceId: 'child',
      contentDesc: 'Next',
      text: 'Continue',
    })
  })

  it('matches resource-id before content-desc and text', () => {
    const root = parseUiHierarchy(xml([
      node('resource-id="other" text="Continue" content-desc="Next"'),
      node('resource-id="expected" text="Different" content-desc="Different" bounds="[0,100][200,200]"'),
    ].join('')))!
    const match = matchSmartElement(root, {
      resourceId: 'expected',
      contentDesc: 'Next',
      text: 'Continue',
    })
    expect(match?.matchedBy).toBe('resource-id')
    expect(match?.node.resourceId).toBe('expected')
  })

  it('falls through to content-desc and then non-password exact text', () => {
    const descRoot = parseUiHierarchy(xml(node('resource-id="" text="Other" content-desc="Next"')))!
    expect(matchSmartElement(descRoot, { resourceId: 'missing', contentDesc: 'Next', text: 'Other' })?.matchedBy).toBe('content-desc')

    const textRoot = parseUiHierarchy(xml(node('resource-id="" text="Continue" content-desc=""')))!
    expect(matchSmartElement(textRoot, { resourceId: 'missing', contentDesc: 'missing', text: 'Continue' })?.matchedBy).toBe('text')
  })
})
