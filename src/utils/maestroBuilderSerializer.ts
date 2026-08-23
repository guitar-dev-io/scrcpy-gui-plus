// Serializes a structured MaestroFlow into Maestro YAML.
//
// The structured MaestroFlow is the application state; this module is the
// only place that turns it into a string. See "YAML SERIALIZER" in
// docs/redesign/script-management.md.
import type { MaestroFlow, MaestroFlowAction } from '../types/maestroBuilder'
import {
  buildSelectorRelationLines,
  findMaestroCommandDefinition,
  yamlString,
} from './maestroCommandRegistry'

function serializeAction(action: MaestroFlowAction): string[] {
  const definition = findMaestroCommandDefinition(action.command)
  if (!definition) {
    return [`# Unsupported Maestro command: ${action.command}`]
  }
  if (definition.serialize) {
    return definition.serialize(action)
  }

  if (definition.requiresChildren) {
    const fieldLines = definition.fields
      .filter((field) => !isEmptyValue(action.config[field.name]))
      .map((field) => `    ${field.name}: ${formatFieldValue(action.config[field.name])}`)
    const childLines = (action.children ?? [])
      .filter((child) => child.enabled)
      .flatMap((child) => indentLines(serializeAction(child), '      '))
    return [`- ${definition.id}:`, ...fieldLines, '    commands:', ...childLines]
  }

  if (definition.requiresElement) {
    const selectorLine = action.selector
      ? `    ${action.selector.type}: ${yamlString(action.selector.value)}`
      : '    text: ""'
    const relationLines = buildSelectorRelationLines(action.selector, '    ')
    const extraFieldLines = definition.fields
      .filter((field) => !isEmptyValue(action.config[field.name]))
      .map((field) => `    ${field.name}: ${formatFieldValue(action.config[field.name])}`)
    return [`- ${definition.id}:`, selectorLine, ...relationLines, ...extraFieldLines]
  }

  if (definition.bareValueField) {
    const raw = action.config[definition.bareValueField]
    const field = definition.fields.find((f) => f.name === definition.bareValueField)
    if (isEmptyValue(raw)) {
      return field?.optional ? [`- ${definition.id}`] : [`- ${definition.id}: ${yamlString('')}`]
    }
    if (field?.type === 'number') {
      return [`- ${definition.id}: ${Number(raw)}`]
    }
    if (field?.type === 'select') {
      return [`- ${definition.id}: ${String(raw)}`]
    }
    return [`- ${definition.id}: ${yamlString(String(raw))}`]
  }

  const activeFields = definition.fields.filter(
    (field) => !isEmptyValue(action.config[field.name]),
  )
  if (activeFields.length === 0) {
    return [`- ${definition.id}`]
  }
  return [
    `- ${definition.id}:`,
    ...activeFields.map((field) => `    ${field.name}: ${formatFieldValue(action.config[field.name])}`),
  ]
}

function indentLines(lines: string[], indent: string): string[] {
  return lines.map((line) => (line ? `${indent}${line}` : line))
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function formatFieldValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return yamlString(String(value ?? ''))
}

export function buildMaestroBuilderYaml(flow: MaestroFlow): string {
  const lines = [`appId: ${yamlString(flow.appId.trim())}`]
  if (flow.tags.length > 0) {
    lines.push('tags:')
    for (const tag of flow.tags) lines.push(`  - ${tag}`)
  }
  const variables = (flow.variables ?? []).filter(
    (variable) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name),
  )
  if (variables.length > 0) {
    lines.push('env:')
    for (const variable of variables) {
      lines.push(`  ${variable.name}: ${yamlString(variable.value)}`)
    }
  }
  lines.push('---')
  for (const action of flow.actions) {
    if (!action.enabled) continue
    lines.push(...serializeAction(action))
  }
  return `${lines.join('\n')}\n`
}
