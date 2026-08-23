// Validates a structured MaestroFlow against its command registry
// definitions. Every action must validate itself so the Run button and
// per-card warning icons stay in sync. See "ACTION VALIDATION" in
// docs/redesign/script-management.md.
import type { MaestroFlow, MaestroFlowAction, MaestroValidationIssue } from '../types/maestroBuilder'
import { findMaestroCommandDefinition } from './maestroCommandRegistry'

/** actionId used for flow-level issues that aren't tied to a single action. */
export const FLOW_LEVEL_ISSUE = '__flow__'

const ANDROID_PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

export function validateMaestroBuilderFlow(flow: MaestroFlow): MaestroValidationIssue[] {
  const issues: MaestroValidationIssue[] = []

  if (!ANDROID_PACKAGE_PATTERN.test(flow.appId.trim())) {
    issues.push({ actionId: FLOW_LEVEL_ISSUE, message: 'Enter a valid Android app package.' })
  }
  if (flow.actions.length === 0) {
    issues.push({ actionId: FLOW_LEVEL_ISSUE, message: 'Add at least one action.' })
  }
  const variableNames = new Set<string>()
  for (const variable of flow.variables ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)) {
      issues.push({ actionId: FLOW_LEVEL_ISSUE, message: `Variable "${variable.name}" must use letters, numbers, or underscores and cannot start with a number.` })
    } else if (variableNames.has(variable.name)) {
      issues.push({ actionId: FLOW_LEVEL_ISSUE, message: `Variable "${variable.name}" is duplicated.` })
    }
    variableNames.add(variable.name)
  }

  for (const action of flow.actions) {
    issues.push(...validateMaestroBuilderAction(action))
  }
  return issues
}

export function validateMaestroBuilderAction(action: MaestroFlowAction): MaestroValidationIssue[] {
  const definition = findMaestroCommandDefinition(action.command)
  if (!definition) {
    return [{ actionId: action.id, message: `Unknown Maestro command "${action.command}".` }]
  }

  const issues: MaestroValidationIssue[] = []

  if (definition.requiresElement && !action.selector?.value.trim()) {
    issues.push({ actionId: action.id, message: `${definition.label} requires a selector.` })
  }

  if (definition.requiresChildren && (action.children?.length ?? 0) === 0) {
    issues.push({ actionId: action.id, message: `${definition.label} requires at least one nested action.` })
  }
  for (const child of action.children ?? []) {
    issues.push(...validateMaestroBuilderAction(child))
  }

  for (const field of definition.fields) {
    const value = action.config[field.name]
    const isEmpty = value === undefined || value === null || value === ''
    if (isEmpty) {
      if (!field.optional) {
        issues.push({ actionId: action.id, message: `${definition.label} requires ${field.label.toLowerCase()}.` })
      }
      continue
    }
    if (field.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) {
        issues.push({ actionId: action.id, message: `${field.label} must be a number.` })
        continue
      }
      if (field.min !== undefined && numeric < field.min) {
        issues.push({ actionId: action.id, message: `${field.label} must be at least ${field.min}.` })
      }
      if (field.max !== undefined && numeric > field.max) {
        issues.push({ actionId: action.id, message: `${field.label} must be at most ${field.max}.` })
      }
    }
  }

  return issues
}

export function isMaestroBuilderFlowValid(flow: MaestroFlow): boolean {
  return validateMaestroBuilderFlow(flow).length === 0
}
