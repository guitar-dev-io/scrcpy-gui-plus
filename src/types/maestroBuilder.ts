// Structured model for the Maestro Builder visual flow editor.
//
// The application state is this structured model, never raw YAML — YAML is a
// derived, read-only representation produced by `maestroBuilderSerializer`.
// See docs/redesign/script-management.md ("INTERNAL FLOW MODEL").

// Mirrors Maestro's actual selector keys (`id`, `text`, `index`, `point`,
// `css`). There is no separate "content description" selector key in real
// Maestro YAML — its `text` matcher already checks content-description, so a
// "Content Description" recommendation is represented as `type: 'text'`.
//
// `css` is deliberately never offered in any command's `supportedSelectors`
// (see maestroCommandRegistry.ts) — per Maestro's own docs, the css selector
// is web-only (https://docs.maestro.dev/reference/selectors/core-selectors).
// This app's hierarchy comes exclusively from Android `uiautomator dump`, so
// there is no DOM/CSS tree to select against. The type stays in the union so
// a future web-target integration (or a raw/custom-YAML action) can produce
// one without a breaking type change, but the UI must never let a user pick
// it for an Android element.
export type MaestroBuilderSelectorType = 'id' | 'text' | 'index' | 'point' | 'css'

// Maestro's relational selectors describe an element by its position or
// containment relative to another element, instead of (or in addition to) a
// direct id/text/index match. Verified against
// https://docs.maestro.dev/reference/selectors/relational-selectors :
// above/below/leftOf/rightOf are position-based; containsChild/childOf are
// direct parent-child; containsDescendants matches at any depth and in real
// Maestro YAML takes a *list* of selectors — this app only ever emits a
// single-item list for it (see maestroCommandRegistry.buildSelectorRelationLines),
// which is valid Maestro YAML but not a full multi-descendant editor.
export type MaestroSelectorRelation =
  | 'above'
  | 'below'
  | 'leftOf'
  | 'rightOf'
  | 'containsChild'
  | 'childOf'
  | 'containsDescendants'

export interface MaestroBuilderSelector {
  type: MaestroBuilderSelectorType
  value: string
  /** Optional relational refinement, e.g. `below: { text: "Total" }`. */
  relation?: MaestroSelectorRelation
  /** The anchor element's value, matched using the same selector `type`. */
  relatedValue?: string
}

export type MaestroCommandCategory =
  | 'common'
  | 'interaction'
  | 'input'
  | 'assertion'
  | 'gesture'
  | 'appState'
  | 'flowControl'
  | 'device'
  | 'media'
  | 'custom'

export type MaestroFieldType = 'text' | 'number' | 'boolean' | 'select'

export interface MaestroFieldOption {
  value: string
  label: string
}

export interface MaestroFieldDefinition {
  name: string
  label: string
  type: MaestroFieldType
  /** Field can be left empty; omitted from output and validation. */
  optional?: boolean
  defaultValue?: string | number | boolean
  options?: MaestroFieldOption[]
  placeholder?: string
  min?: number
  max?: number
}

export type MaestroCommandId = string

export type MaestroFieldValue = string | number | boolean

export interface MaestroCommandDefinition {
  id: MaestroCommandId
  label: string
  description: string
  category: MaestroCommandCategory
  /** Shown pinned at the top of the Action Library regardless of category. */
  common?: boolean
  requiresElement?: boolean
  supportedSelectors?: MaestroBuilderSelectorType[]
  fields: MaestroFieldDefinition[]
  /**
   * When set, this field's value is written as the command's bare scalar
   * value (`- pressKey: Home`) instead of a nested field map. Only valid
   * when the command does not require an element selector.
   */
  bareValueField?: string
  /** Escape hatch for commands whose YAML shape a generic engine can't express. */
  serialize?: (action: MaestroFlowAction) => string[]
}

export interface MaestroFlowAction {
  id: string
  command: MaestroCommandId
  enabled: boolean
  selector?: MaestroBuilderSelector
  config: Record<string, MaestroFieldValue>
}

export interface MaestroFlow {
  id: string
  name: string
  appId: string
  tags: string[]
  actions: MaestroFlowAction[]
  createdAt: string
  updatedAt: string
}

export interface MaestroValidationIssue {
  actionId: string
  message: string
}

export interface MaestroSelectorRecommendation {
  selector: MaestroBuilderSelector
  label: string
  stars: 1 | 2 | 3 | 4 | 5
  reason: string
}
