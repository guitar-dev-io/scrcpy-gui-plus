import type { ElementSelector } from '../types/macro'
import {
  flattenNodes,
  type UiNode,
} from '../types/uiInspector'

export type TapBroadcastMode = 'smart' | 'relative' | 'raw'

export type SmartElementMatch = {
  node: UiNode
  matchedBy: 'resource-id' | 'content-desc' | 'text'
}

function containsPoint(node: UiNode, x: number, y: number): boolean {
  const { bounds } = node
  return bounds.width > 0 && bounds.height > 0 &&
    x >= bounds.x && x <= bounds.x + bounds.width &&
    y >= bounds.y && y <= bounds.y + bounds.height
}

function usable(node: UiNode): boolean {
  return node.enabled && node.bounds.width > 0 && node.bounds.height > 0
}

/**
 * Select the smallest identifiable node under the master tap. Blank layout
 * wrappers are ignored so a labelled parent can still drive Smart mode.
 */
export function selectorAtPoint(
  root: UiNode,
  x: number,
  y: number,
): ElementSelector | null {
  const candidates = flattenNodes(root)
    .filter((node) =>
      containsPoint(node, x, y) &&
      usable(node) &&
      Boolean(node.resourceId || node.contentDesc || (!node.password && node.text.trim())),
    )
    .sort((a, b) =>
      (a.bounds.width * a.bounds.height) - (b.bounds.width * b.bounds.height),
    )
  const node = candidates[0]
  if (!node) return null
  return {
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.contentDesc ? { contentDesc: node.contentDesc } : {}),
    ...(!node.password && node.text.trim() ? { text: node.text.trim() } : {}),
    ...(node.className ? { className: node.className } : {}),
    ...(node.packageName ? { package: node.packageName } : {}),
  }
}

function chooseCandidate(
  candidates: UiNode[],
  selector: ElementSelector,
): UiNode | null {
  const usableCandidates = candidates.filter(usable)
  if (usableCandidates.length <= 1) return usableCandidates[0] ?? null

  const refined = usableCandidates.filter((node) =>
    (!selector.className || node.className === selector.className) &&
    (!selector.package || node.packageName === selector.package) &&
    (!selector.contentDesc || node.contentDesc === selector.contentDesc) &&
    (!selector.text || node.text.trim() === selector.text),
  )
  return refined[0] ?? usableCandidates[0]
}

/** Match using the deliberately stable Phase 4 preference order. */
export function matchSmartElement(
  root: UiNode,
  selector: ElementSelector,
): SmartElementMatch | null {
  const nodes = flattenNodes(root)
  if (selector.resourceId) {
    const node = chooseCandidate(
      nodes.filter((candidate) => candidate.resourceId === selector.resourceId),
      selector,
    )
    if (node) return { node, matchedBy: 'resource-id' }
  }
  if (selector.contentDesc) {
    const node = chooseCandidate(
      nodes.filter((candidate) => candidate.contentDesc === selector.contentDesc),
      selector,
    )
    if (node) return { node, matchedBy: 'content-desc' }
  }
  if (selector.text?.trim()) {
    const text = selector.text.trim()
    const node = chooseCandidate(
      nodes.filter((candidate) => !candidate.password && candidate.text.trim() === text),
      selector,
    )
    if (node) return { node, matchedBy: 'text' }
  }
  return null
}
