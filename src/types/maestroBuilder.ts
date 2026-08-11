// Structured model for the Maestro Builder visual flow editor.
//
// The application state is this structured model, never raw YAML — YAML is a
// derived, read-only representation produced by `maestroBuilderSerializer`.
// See docs/redesign/script-management.md ("INTERNAL FLOW MODEL").

// Mirrors Maestro's actual selector keys (`id`, `text`, `index`, `point`,
// `css`). There is no separate "content description" selector key in real
// Maestro YAML — its `text` matcher already checks content-description, so a
// "Content Description" recommendation is represented as `type: 'text'`.
export type MaestroBuilderSelectorType = 'id' | 'text' | 'index' | 'point' | 'css'

export interface MaestroBuilderSelector {
  type: MaestroBuilderSelectorType
  value: string
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
