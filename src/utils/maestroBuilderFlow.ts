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

/**
 * Locates the sibling array that contains `actionId` — whether that's the
 * top-level `flow.actions` or a container action's `children` at any depth
 * — and replaces it with `transform(siblings, index)`. No-op if the id
 * isn't found anywhere in the tree. This is the one tree-walk every
 * position-based mutator (move/duplicate/remove) is built on, so nesting
 * support doesn't need to be reimplemented per mutator.
 */
function transformSiblingArray(
  actions: MaestroFlowAction[],
  actionId: string,
  transform: (siblings: MaestroFlowAction[], index: number) => MaestroFlowAction[],
): MaestroFlowAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index !== -1) return transform(actions, index)

  let changed = false
  const next = actions.map((action) => {
    if (!action.children) return action
    const updatedChildren = transformSiblingArray(action.children, actionId, transform)
    if (updatedChildren === action.children) return action
    changed = true
    return { ...action, children: updatedChildren }
  })
  return changed ? next : actions
}

/** Finds `actionId` anywhere in the tree and replaces it with `updater(action)`. */
export function updateMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
  updater: (action: MaestroFlowAction) => MaestroFlowAction,
): MaestroFlowAction[] {
  let changed = false
  const next = actions.map((action) => {
    if (action.id === actionId) {
      changed = true
      return updater(action)
    }
    if (action.children) {
      const updatedChildren = updateMaestroFlowAction(action.children, actionId, updater)
      if (updatedChildren !== action.children) {
        changed = true
        return { ...action, children: updatedChildren }
      }
    }
    return action
  })
  return changed ? next : actions
}

/** Appends `child` to a container action's nested `children` list. */
export function addMaestroChildAction(
  actions: MaestroFlowAction[],
  parentActionId: string,
  child: MaestroFlowAction,
): MaestroFlowAction[] {
  return updateMaestroFlowAction(actions, parentActionId, (parent) => ({
    ...parent,
    children: [...(parent.children ?? []), child],
  }))
}

export function moveMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
  direction: 'up' | 'down',
): MaestroFlowAction[] {
  return transformSiblingArray(actions, actionId, (siblings, index) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= siblings.length) return siblings
    const next = siblings.slice()
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    return next
  })
}

export function duplicateMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  return transformSiblingArray(actions, actionId, (siblings, index) => {
    const copy: MaestroFlowAction = { ...siblings[index], id: nextActionId() }
    const next = siblings.slice()
    next.splice(index + 1, 0, copy)
    return next
  })
}

export function removeMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  return transformSiblingArray(actions, actionId, (siblings, index) => {
    const next = siblings.slice()
    next.splice(index, 1)
    return next
  })
}
