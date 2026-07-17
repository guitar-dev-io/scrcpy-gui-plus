// UI Inspector types shared across the service, hook and UI.
//
// The Rust backend returns the raw uiautomator XML (UiDumpResult) plus a
// base64 screenshot (ScreenCaptureResult). The XML is parsed into a UiNode
// tree here on the frontend via the browser DOMParser.

import type { ElementSelector } from './macro'

/** Result of `dump_ui_hierarchy` (mirrors the Rust model, camelCase). */
export interface UiDumpResult {
  success: boolean
  xml?: string
  error?: string
  errorCode?: string
}

/** Result of `capture_screen_base64` (mirrors the Rust model, camelCase). */
export interface ScreenCaptureResult {
  success: boolean
  dataUrl?: string
  error?: string
  errorCode?: string
}

/** Pixel bounds of a node on the device screen. */
export interface NodeBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A single parsed node from the view hierarchy. */
export interface UiNode {
  /** Stable id assigned during parsing (depth-first order). */
  id: number
  /** Sibling index reported by uiautomator. */
  index: number
  resourceId: string
  className: string
  packageName: string
  text: string
  contentDesc: string
  clickable: boolean
  enabled: boolean
  focused: boolean
  focusable: boolean
  scrollable: boolean
  longClickable: boolean
  password: boolean
  checkable: boolean
  checked: boolean
  selected: boolean
  bounds: NodeBounds
  /** Best-effort XPath usable in Appium/UiAutomator selectors. */
  xpath: string
  children: UiNode[]
  depth: number
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? ''
}

function boolAttr(el: Element, name: string): boolean {
  return attr(el, name) === 'true'
}

/** Parse a uiautomator bounds string "[x1,y1][x2,y2]" into pixel bounds. */
export function parseBounds(raw: string): NodeBounds {
  const match = raw.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!match) return { x: 0, y: 0, width: 0, height: 0 }
  const x1 = parseInt(match[1], 10)
  const y1 = parseInt(match[2], 10)
  const x2 = parseInt(match[3], 10)
  const y2 = parseInt(match[4], 10)
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  }
}

/** Short class name (last segment) for display, e.g. `android.widget.Button` -> `Button`. */
export function shortClassName(className: string): string {
  if (!className) return 'node'
  const parts = className.split('.')
  return parts[parts.length - 1] || className
}

/**
 * Build a best-effort XPath for a node. Prefers a resource-id, then a text or
 * content-desc match, then falls back to a positional index among siblings of
 * the same class. Mirrors the selectors QA engineers write in Appium.
 */
function buildXpath(
  className: string,
  el: Element,
  siblingIndexByClass: number,
): string {
  const cls = className || '*'
  const resourceId = attr(el, 'resource-id')
  if (resourceId) {
    return `//${cls}[@resource-id="${resourceId}"]`
  }
  const text = attr(el, 'text')
  if (text) {
    return `//${cls}[@text="${text.replace(/"/g, '\\"')}"]`
  }
  const desc = attr(el, 'content-desc')
  if (desc) {
    return `//${cls}[@content-desc="${desc.replace(/"/g, '\\"')}"]`
  }
  // 1-based positional index like UiAutomator/XPath expects.
  return `//${cls}[${siblingIndexByClass + 1}]`
}

function mapNode(
  el: Element,
  depth: number,
  counter: { value: number },
): UiNode {
  const className = attr(el, 'class')
  const id = counter.value++

  // Count preceding siblings sharing this class for a positional xpath.
  let sameClassBefore = 0
  let prev = el.previousElementSibling
  while (prev) {
    if (prev.tagName === 'node' && prev.getAttribute('class') === className) {
      sameClassBefore++
    }
    prev = prev.previousElementSibling
  }

  const node: UiNode = {
    id,
    index: parseInt(attr(el, 'index') || '0', 10) || 0,
    resourceId: attr(el, 'resource-id'),
    className,
    packageName: attr(el, 'package'),
    text: attr(el, 'text'),
    contentDesc: attr(el, 'content-desc'),
    clickable: boolAttr(el, 'clickable'),
    enabled: boolAttr(el, 'enabled'),
    focused: boolAttr(el, 'focused'),
    focusable: boolAttr(el, 'focusable'),
    scrollable: boolAttr(el, 'scrollable'),
    longClickable: boolAttr(el, 'long-clickable'),
    password: boolAttr(el, 'password'),
    checkable: boolAttr(el, 'checkable'),
    checked: boolAttr(el, 'checked'),
    selected: boolAttr(el, 'selected'),
    bounds: parseBounds(attr(el, 'bounds')),
    xpath: buildXpath(
      shortClassName(className) ? className : '*',
      el,
      sameClassBefore,
    ),
    children: [],
    depth,
  }

  const childEls = Array.from(el.children).filter((c) => c.tagName === 'node')
  node.children = childEls.map((c) => mapNode(c, depth + 1, counter))
  return node
}

/**
 * Parse a uiautomator XML dump into a UiNode tree. Returns null when the XML
 * is malformed or contains no nodes.
 */
export function parseUiHierarchy(xml: string): UiNode | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    const root = doc.querySelector('hierarchy')
    if (!root) return null

    const topNodes = Array.from(root.children).filter(
      (c) => c.tagName === 'node',
    )
    if (topNodes.length === 0) return null

    const counter = { value: 0 }

    // A hierarchy can have multiple top-level windows. Wrap them in a
    // synthetic root so the tree always has a single entry point.
    if (topNodes.length === 1) {
      return mapNode(topNodes[0], 0, counter)
    }

    const children = topNodes.map((n) => mapNode(n, 1, counter))
    const bounds = children.reduce<NodeBounds>(
      (acc, c) => ({
        x: 0,
        y: 0,
        width: Math.max(acc.width, c.bounds.x + c.bounds.width),
        height: Math.max(acc.height, c.bounds.y + c.bounds.height),
      }),
      { x: 0, y: 0, width: 0, height: 0 },
    )

    return {
      id: -1,
      index: 0,
      resourceId: '',
      className: 'hierarchy',
      packageName: '',
      text: '',
      contentDesc: '',
      clickable: false,
      enabled: true,
      focused: false,
      focusable: false,
      scrollable: false,
      longClickable: false,
      password: false,
      checkable: false,
      checked: false,
      selected: false,
      bounds,
      xpath: '//hierarchy',
      children,
      depth: 0,
    }
  } catch {
    return null
  }
}

/** Build a resilient selector from a node for element-based automation. */
export function selectorFromNode(node: UiNode): ElementSelector {
  const sel: ElementSelector = {}
  if (node.resourceId) sel.resourceId = node.resourceId
  if (node.text) sel.text = node.text
  if (node.contentDesc) sel.contentDesc = node.contentDesc
  if (node.className) sel.className = node.className
  if (node.xpath) sel.xpath = node.xpath
  if (node.packageName) sel.package = node.packageName
  return sel
}

/**
 * Find a node in a (freshly dumped) tree that matches a selector. Preference
 * order mirrors selector reliability: resource-id, then text, then
 * content-desc, then the recorded xpath. Returns null when nothing matches.
 */
export function findNodeBySelector(
  root: UiNode,
  sel: ElementSelector,
): UiNode | null {
  const all = flattenNodes(root)
  const byId = sel.resourceId
    ? all.filter((n) => n.resourceId && n.resourceId === sel.resourceId)
    : []
  if (byId.length === 1) return byId[0]
  if (byId.length > 1) {
    // Disambiguate identical ids by a secondary text / content-desc match.
    const refined = byId.find(
      (n) =>
        (sel.text && n.text === sel.text) ||
        (sel.contentDesc && n.contentDesc === sel.contentDesc),
    )
    return refined ?? byId[0]
  }
  if (sel.text) {
    const byText = all.find((n) => n.text && n.text === sel.text)
    if (byText) return byText
  }
  if (sel.contentDesc) {
    const byDesc = all.find(
      (n) => n.contentDesc && n.contentDesc === sel.contentDesc,
    )
    if (byDesc) return byDesc
  }
  if (sel.xpath) {
    const byXpath = all.find((n) => n.xpath === sel.xpath)
    if (byXpath) return byXpath
  }
  return null
}

/** Center point (device pixels) of a node's bounds. */
export function nodeCenter(node: UiNode): { x: number; y: number } {
  return {
    x: node.bounds.x + Math.round(node.bounds.width / 2),
    y: node.bounds.y + Math.round(node.bounds.height / 2),
  }
}

/** Flatten a node tree into a depth-first list (useful for hit-testing). */
export function flattenNodes(root: UiNode): UiNode[] {
  const out: UiNode[] = []
  const walk = (n: UiNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

/**
 * Find the deepest (smallest-area) node whose bounds contain the point.
 * Used to select the most specific element under a click.
 */
export function nodeAtPoint(root: UiNode, x: number, y: number): UiNode | null {
  let best: UiNode | null = null
  let bestArea = Infinity
  for (const n of flattenNodes(root)) {
    const b = n.bounds
    if (b.width <= 0 || b.height <= 0) continue
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      const area = b.width * b.height
      if (area <= bestArea) {
        bestArea = area
        best = n
      }
    }
  }
  return best
}
