// Parses Maestro flow YAML back into the structured MaestroFlow model, so
// "Import YAML" never has to fall back to treating the whole file as an
// opaque blob. This is a targeted parser for Maestro's actual flow shape (a
// header, `---`, then a list of single- or two-level command maps) — not a
// general YAML parser — because that shape is simple and regular enough to
// parse by hand without adding a YAML dependency.
//
// Commands the registry doesn't recognize are never dropped: they're kept as
// an "Unsupported Maestro Command" action that re-serializes byte-for-byte
// from the original block. See "YAML IMPORT" in
// docs/redesign/script-management.md.
import type {
  MaestroBuilderSelector,
  MaestroBuilderSelectorType,
  MaestroFlow,
  MaestroFlowAction,
  MaestroSelectorRelation,
} from '../types/maestroBuilder'
import { createEmptyMaestroFlow, createMaestroFlowAction } from './maestroBuilderFlow'
import { findMaestroCommandDefinition, UNSUPPORTED_COMMAND_ID } from './maestroCommandRegistry'

const RELATION_KEYWORDS: MaestroSelectorRelation[] = [
  'above',
  'below',
  'leftOf',
  'rightOf',
  'containsChild',
  'childOf',
  'containsDescendants',
]

/**
 * Finds a relational-selector block (e.g. `below:\n  text: "Total"`, or the
 * single-item `containsDescendants:\n  - text: "..."` list form) anywhere
 * among a command's body lines and returns it as `{relation, relatedValue}`.
 * Mirrors maestroCommandRegistry.buildSelectorRelationLines in reverse.
 */
function parseRelation(bodyLines: string[]): { relation: MaestroSelectorRelation; relatedValue: string } | null {
  for (let i = 0; i < bodyLines.length; i += 1) {
    const keywordMatch = bodyLines[i].trim().match(/^([A-Za-z]+)\s*:\s*$/)
    if (!keywordMatch) continue
    const keyword = keywordMatch[1] as MaestroSelectorRelation
    if (!RELATION_KEYWORDS.includes(keyword)) continue
    const nextLine = bodyLines[i + 1]
    if (!nextLine) continue
    const valueLine = nextLine.trim().replace(/^-\s*/, '')
    const valueMatch = valueLine.match(/^(?:id|text|index|point|css)\s*:\s*(.*)$/)
    if (!valueMatch) continue
    return { relation: keyword, relatedValue: unquoteYamlScalar(valueMatch[1]) }
  }
  return null
}

function withRelation(
  selector: { type: MaestroBuilderSelectorType; value: string } | null,
  bodyLines: string[],
): MaestroBuilderSelector | undefined {
  if (!selector) return undefined
  const relation = parseRelation(bodyLines)
  return relation ? { ...selector, ...relation } : selector
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function parseSelectorLine(line: string): { type: MaestroBuilderSelectorType; value: string } | null {
  const match = line.trim().match(/^(id|text|index|point|css)\s*:\s*(.*)$/)
  if (!match) return null
  return { type: match[1] as MaestroBuilderSelectorType, value: unquoteYamlScalar(match[2]) }
}

function findLine(bodyLines: string[], keyword: string): string | undefined {
  return bodyLines.find((line) => line.trim().startsWith(`${keyword}:`))
}

function rawAction(block: string[]): MaestroFlowAction {
  return {
    ...createMaestroFlowAction(UNSUPPORTED_COMMAND_ID),
    config: { raw: block.join('\n') },
  }
}

function parseBlock(block: string[]): MaestroFlowAction {
  const header = block[0].match(/^-\s*([A-Za-z][A-Za-z0-9]*)\s*(:\s*(.*))?$/)
  if (!header) return rawAction(block)

  const command = header[1]
  const hasColon = header[2] !== undefined
  const inline = (header[3] ?? '').trim()
  const bodyLines = block.slice(1)

  if (command === 'extendedWaitUntil') {
    const selectorLine = bodyLines.find((line) => parseSelectorLine(line) && indentOf(line) > indentOf(bodyLines[0] ?? ''))
      ?? bodyLines[1]
    const selector = selectorLine ? parseSelectorLine(selectorLine) : null
    const timeoutLine = findLine(bodyLines, 'timeout')
    const timeoutMs = timeoutLine ? Number(timeoutLine.split(':')[1]) : 20_000
    const action = createMaestroFlowAction('waitFor', withRelation(selector, bodyLines))
    action.config = { timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20_000 }
    return action
  }

  if (command === 'scrollUntilVisible') {
    const selectorLine = bodyLines[1]
    const selector = selectorLine ? parseSelectorLine(selectorLine) : null
    const directionLine = findLine(bodyLines, 'direction')
    const timeoutLine = findLine(bodyLines, 'timeout')
    const action = createMaestroFlowAction('scrollUntilVisible', withRelation(selector, bodyLines))
    action.config = {
      direction: directionLine ? directionLine.split(':')[1].trim() : 'DOWN',
      timeoutMs: timeoutLine ? Number(timeoutLine.split(':')[1]) || 20_000 : 20_000,
    }
    return action
  }

  if (command === 'swipe') {
    const directionLine = findLine(bodyLines, 'direction')
    const action = createMaestroFlowAction('swipe')
    action.config = { direction: directionLine ? directionLine.split(':')[1].trim() : 'UP' }
    return action
  }

  if (command === 'setLocation') {
    const latLine = findLine(bodyLines, 'latitude')
    const lonLine = findLine(bodyLines, 'longitude')
    const action = createMaestroFlowAction('setLocation')
    action.config = {
      latitude: latLine ? Number(latLine.split(':')[1]) : 0,
      longitude: lonLine ? Number(lonLine.split(':')[1]) : 0,
    }
    return action
  }

  if (command === 'assertTrue') {
    const conditionLine = findLine(bodyLines, 'condition')
    const action = createMaestroFlowAction('assertTrue')
    action.config = {
      condition: conditionLine ? unquoteYamlScalar(conditionLine.split(/:(.*)/)[1] ?? '') : '',
    }
    return action
  }

  if (command === 'waitForAnimationToEnd') {
    const timeoutLine = findLine(bodyLines, 'timeout')
    const action = createMaestroFlowAction('waitForAnimationToEnd')
    const timeoutValue = timeoutLine ? Number(timeoutLine.split(':')[1]) : NaN
    if (Number.isFinite(timeoutValue)) action.config = { timeoutMs: timeoutValue }
    return action
  }

  const definition = findMaestroCommandDefinition(command)
  if (!definition) return rawAction(block)

  if (definition.requiresElement) {
    const selectorLine = bodyLines[0]
    const selector = selectorLine ? parseSelectorLine(selectorLine) : null
    return createMaestroFlowAction(command, withRelation(selector, bodyLines))
  }

  if (definition.bareValueField) {
    const field = definition.fields.find((f) => f.name === definition.bareValueField)
    const action = createMaestroFlowAction(command)
    if (!hasColon || inline === '') return action
    if (field?.type === 'number') action.config = { [definition.bareValueField]: Number(inline) }
    else action.config = { [definition.bareValueField]: unquoteYamlScalar(inline) }
    return action
  }

  // Generic map-shaped command (e.g. launchApp): each body line is `key: value`.
  const action = createMaestroFlowAction(command)
  const config: MaestroFlowAction['config'] = {}
  for (const line of bodyLines) {
    const fieldMatch = line.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/)
    if (!fieldMatch) continue
    const fieldDefinition = definition.fields.find((f) => f.name === fieldMatch[1])
    const rawValue = fieldMatch[2]
    if (fieldDefinition?.type === 'boolean') config[fieldMatch[1]] = rawValue.trim() === 'true'
    else if (fieldDefinition?.type === 'number') config[fieldMatch[1]] = Number(rawValue)
    else config[fieldMatch[1]] = unquoteYamlScalar(rawValue)
  }
  action.config = config
  return action
}

function groupBlocks(bodyLines: string[]): string[][] {
  const blocks: string[][] = []
  for (const line of bodyLines) {
    if (line.trim() === '') continue
    if (/^-\s/.test(line) || line.trim() === '-') {
      blocks.push([line])
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].push(line)
    }
  }
  return blocks
}

export function parseMaestroBuilderYaml(yaml: string, name = 'Imported flow'): MaestroFlow {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n')
  const headerLines: string[] = []
  const bodyLines: string[] = []
  let seenSeparator = false
  for (const line of lines) {
    if (!seenSeparator) {
      if (line.trim() === '---') {
        seenSeparator = true
        continue
      }
      headerLines.push(line)
    } else {
      bodyLines.push(line)
    }
  }

  let appId = ''
  const tags: string[] = []
  for (let i = 0; i < headerLines.length; i += 1) {
    const line = headerLines[i]
    const appIdMatch = line.match(/^appId:\s*(.*)$/)
    if (appIdMatch) {
      appId = unquoteYamlScalar(appIdMatch[1])
      continue
    }
    if (line.trim() === 'tags:') {
      let j = i + 1
      while (j < headerLines.length && /^\s*-\s*/.test(headerLines[j])) {
        tags.push(headerLines[j].replace(/^\s*-\s*/, '').trim())
        j += 1
      }
      i = j - 1
    }
  }

  const flow = createEmptyMaestroFlow(appId, name)
  flow.tags = tags
  flow.actions = groupBlocks(bodyLines).map(parseBlock)
  return flow
}
