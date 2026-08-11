// Construction helpers for the structured MaestroFlow model — the
// registry-driven counterpart to the legacy `maestroFlow.ts` factory, used by
// the visual Flow Builder (docs/redesign/script-management.md).
import type {
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroBuilderSelector,
} from '../types/maestroBuilder'
import { findMaestroCommandDefinition } from './maestroCommandRegistry'

let actionSequence = 0

function nextActionId(): string {
  actionSequence += 1
  return `maestro-flow-action-${Date.now().toString(36)}-${actionSequence}`
}

/** Build an action with its registry-defined default field values pre-filled. */
export function createMaestroFlowAction(
  command: MaestroCommandId,
  selector?: MaestroBuilderSelector,
): MaestroFlowAction {
  const definition = findMaestroCommandDefinition(command)
  const config: MaestroFlowAction['config'] = {}
  for (const field of definition?.fields ?? []) {
    if (field.defaultValue !== undefined) config[field.name] = field.defaultValue
  }
  return {
    id: nextActionId(),
    command,
    enabled: true,
    selector: definition?.requiresElement ? selector : undefined,
    config,
  }
}

export function createEmptyMaestroFlow(appId: string, name: string): MaestroFlow {
  const now = new Date().toISOString()
  return {
    id: `maestro-flow-${Date.now().toString(36)}`,
    name,
    appId,
    tags: [],
    actions: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function moveMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
  direction: 'up' | 'down',
): MaestroFlowAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index === -1) return actions
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= actions.length) return actions
  const next = actions.slice()
  ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
  return next
}

export function duplicateMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index === -1) return actions
  const copy: MaestroFlowAction = { ...actions[index], id: nextActionId() }
  const next = actions.slice()
  next.splice(index + 1, 0, copy)
  return next
}

export function removeMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  return actions.filter((action) => action.id !== actionId)
}
