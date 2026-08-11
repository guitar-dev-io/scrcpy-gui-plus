// Ranks candidate Maestro selectors for a selected element, built on top of
// the existing UiNode hierarchy already produced by the UI Inspector
// (uiautomator dump). A selector is only called "unique" when verified
// against the full current hierarchy — see "RECOMMENDED SELECTORS" and
// "SELECTOR STABILITY" in docs/redesign/script-management.md.
import { flattenNodes, nodeCenter, type UiNode } from '../types/uiInspector'
import type { MaestroSelectorRecommendation } from '../types/maestroBuilder'

function countMatching(nodes: UiNode[], predicate: (node: UiNode) => boolean): number {
  let count = 0
  for (const node of nodes) {
    if (predicate(node)) count += 1
  }
  return count
}

/**
 * Build ranked selector candidates for `node` within `root`'s hierarchy.
 * Ordered highest-confidence first: unique resource ID > unique content
 * description / text > index > point.
 */
export function recommendMaestroSelectors(
  root: UiNode,
  node: UiNode,
): MaestroSelectorRecommendation[] {
  const all = flattenNodes(root)
  const recommendations: MaestroSelectorRecommendation[] = []

  if (node.resourceId) {
    const shortId = node.resourceId.includes('/')
      ? (node.resourceId.split('/').pop() ?? node.resourceId)
      : node.resourceId
    const matches = countMatching(all, (n) => n.resourceId === node.resourceId)
    const unique = matches === 1
    recommendations.push({
      selector: { type: 'id', value: shortId },
      label: 'ID',
      stars: unique ? 5 : 2,
      reason: unique
        ? 'Resource ID is unique in the current hierarchy.'
        : `Resource ID appears on ${matches} elements — not unique.`,
    })
  }

  if (node.contentDesc) {
    const matches = countMatching(all, (n) => n.contentDesc === node.contentDesc)
    const unique = matches === 1
    recommendations.push({
      selector: { type: 'text', value: node.contentDesc },
      label: 'Content Description',
      stars: unique ? 4 : 2,
      reason: unique
        ? "Content description is unique; Maestro's text matcher also checks content description."
        : `Content description appears on ${matches} elements — not unique.`,
    })
  }

  if (node.text) {
    const matches = countMatching(all, (n) => n.text === node.text)
    const unique = matches === 1
    recommendations.push({
      selector: { type: 'text', value: node.text },
      label: 'Text',
      stars: unique ? 4 : 2,
      reason: unique
        ? 'Visible text is unique in the current hierarchy.'
        : `Text appears on ${matches} elements — not unique.`,
    })
  }

  recommendations.push({
    selector: { type: 'index', value: String(node.index) },
    label: 'Index',
    stars: 2,
    reason: 'Positional selector — breaks if sibling elements change.',
  })

  const center = nodeCenter(node)
  recommendations.push({
    selector: { type: 'point', value: `${center.x},${center.y}` },
    label: 'Point',
    stars: 1,
    reason: 'Absolute coordinates — most fragile, breaks on any layout change.',
  })

  return recommendations.sort((a, b) => b.stars - a.stars)
}

/** Highest-confidence selector, i.e. what "Tap" / quick actions should use. */
export function bestMaestroSelector(root: UiNode, node: UiNode) {
  return recommendMaestroSelectors(root, node)[0]?.selector
}
