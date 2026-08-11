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
  const randomSuffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `maestro-flow-action-${Date.now().toString(36)}-${actionSequence}-${randomSuffix}`
}

/** Build an action with its registry-defined default field values pre-filled. */
export function createMaestroFlowAction(
  command: MaestroCommandId,
  selector?: MaestroBuilderSelector,
): MaestroFlowAction {
  const definition = findMaestroCommandDefinition(command)
  const config: MaestroFlowAction['config'] = {}
  for (const field of definition?.fields ?? []) {
    if (field.defaultValue !== undefined)
      config[field.name] = field.defaultValue
  }
  return {
    id: nextActionId(),
    command,
    enabled: true,
    selector: definition?.requiresElement ? selector : undefined,
    config,
  }
}

export function createEmptyMaestroFlow(
  appId: string,
  name: string,
): MaestroFlow {
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

/** The location of an action in its immediate sibling list. */
export interface MaestroFlowActionLocation {
  action: MaestroFlowAction
  parent: MaestroFlowAction | null
  siblings: MaestroFlowAction[]
  index: number
}

/** Finds an action at any nesting depth. */
export function findMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction | null {
  return findMaestroFlowActionLocation(actions, actionId)?.action ?? null
}

function findMaestroFlowActionLocation(
  actions: MaestroFlowAction[],
  actionId: string,
  parent: MaestroFlowAction | null = null,
): MaestroFlowActionLocation | null {
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    if (action.id === actionId) {
      return { action, parent, siblings: actions, index }
    }
    if (action.children) {
      const nested = findMaestroFlowActionLocation(
        action.children,
        actionId,
        action,
      )
      if (nested) return nested
    }
  }
  return null
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
  transform: (
    siblings: MaestroFlowAction[],
    index: number,
  ) => MaestroFlowAction[],
): MaestroFlowAction[] {
  const index = actions.findIndex((action) => action.id === actionId)
  if (index !== -1) return transform(actions, index)

  let changed = false
  const next = actions.map((action) => {
    if (!action.children) return action
    const updatedChildren = transformSiblingArray(
      action.children,
      actionId,
      transform,
    )
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
      const updatedChildren = updateMaestroFlowAction(
        action.children,
        actionId,
        updater,
      )
      if (updatedChildren !== action.children) {
        changed = true
        return { ...action, children: updatedChildren }
      }
    }
    return action
  })
  return changed ? next : actions
}

export interface MaestroFlowActionAddChildResult {
  actions: MaestroFlowAction[]
  childId: string | null
}

/** Appends `child` to a container action's nested `children` list. */
export function addMaestroChildActionWithResult(
  actions: MaestroFlowAction[],
  parentActionId: string,
  child: MaestroFlowAction,
): MaestroFlowActionAddChildResult {
  let added = false
  const next = updateMaestroFlowAction(actions, parentActionId, (parent) => {
    added = true
    return {
      ...parent,
      children: [...(parent.children ?? []), child],
    }
  })
  return { actions: next, childId: added ? child.id : null }
}

export function addMaestroChildAction(
  actions: MaestroFlowAction[],
  parentActionId: string,
  child: MaestroFlowAction,
): MaestroFlowAction[] {
  return addMaestroChildActionWithResult(actions, parentActionId, child).actions
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

/**
 * Deeply clones an action tree. Every action, including every descendant,
 * receives a new id and mutable selector/config containers are copied.
 */
function cloneActionWithFreshIds(action: MaestroFlowAction): MaestroFlowAction {
  return {
    ...action,
    id: nextActionId(),
    selector: action.selector ? { ...action.selector } : undefined,
    config: { ...action.config },
    children: action.children?.map(cloneActionWithFreshIds),
  }
}

export interface MaestroFlowActionDuplicateResult {
  actions: MaestroFlowAction[]
  duplicatedActionId: string | null
}

export function duplicateMaestroFlowActionWithResult(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowActionDuplicateResult {
  let duplicatedActionId: string | null = null
  const next = transformSiblingArray(actions, actionId, (siblings, index) => {
    const copy = cloneActionWithFreshIds(siblings[index])
    duplicatedActionId = copy.id
    const updatedSiblings = siblings.slice()
    updatedSiblings.splice(index + 1, 0, copy)
    return updatedSiblings
  })
  return { actions: next, duplicatedActionId }
}

export function duplicateMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  return duplicateMaestroFlowActionWithResult(actions, actionId).actions
}

function collectActionIds(action: MaestroFlowAction): string[] {
  return [
    action.id,
    ...(action.children?.flatMap((child) => collectActionIds(child)) ?? []),
  ]
}

export interface MaestroFlowActionRemovalResult {
  actions: MaestroFlowAction[]
  removedActionIds: string[]
  /** Next/previous sibling, then the containing action, or null. */
  nextSelectionId: string | null
}

export function removeMaestroFlowActionWithResult(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowActionRemovalResult {
  const location = findMaestroFlowActionLocation(actions, actionId)
  if (!location) {
    return { actions, removedActionIds: [], nextSelectionId: null }
  }

  const nextSelectionId =
    location.siblings[location.index + 1]?.id ??
    location.siblings[location.index - 1]?.id ??
    location.parent?.id ??
    null
  const removedActionIds = collectActionIds(location.action)
  const next = transformSiblingArray(actions, actionId, (siblings, index) => {
    const updatedSiblings = siblings.slice()
    updatedSiblings.splice(index, 1)
    return updatedSiblings
  })
  return { actions: next, removedActionIds, nextSelectionId }
}

export function removeMaestroFlowAction(
  actions: MaestroFlowAction[],
  actionId: string,
): MaestroFlowAction[] {
  return removeMaestroFlowActionWithResult(actions, actionId).actions
}
