import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../types/maestroBuilder'
import {
  addMaestroChildActionWithResult,
  createEmptyMaestroFlow,
  createMaestroFlowAction,
  duplicateMaestroFlowActionWithResult,
  findMaestroFlowAction,
  moveMaestroFlowAction,
  removeMaestroFlowActionWithResult,
  updateMaestroFlowAction,
} from '../utils/maestroBuilderFlow'
import { buildMaestroBuilderYaml } from '../utils/maestroBuilderSerializer'
import { validateMaestroBuilderFlow } from '../utils/maestroBuilderValidator'
import {
  createMaestroFlowFromTemplate,
  type MaestroTemplateId,
} from '../utils/maestro/templates'

const DRAFT_KEY = 'scrcpy_maestro_builder_draft'
const LIBRARY_KEY = 'scrcpy_maestro_builder_flows'

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function loadLibrary(): MaestroFlow[] {
  return loadJson<MaestroFlow[]>(LIBRARY_KEY) ?? []
}

export function useMaestroBuilder(defaultAppId: string) {
  const [flow, setFlow] = useState<MaestroFlow>(
    () =>
      loadJson<MaestroFlow>(DRAFT_KEY) ??
      createEmptyMaestroFlow(defaultAppId, 'New Flow'),
  )
  const [library, setLibrary] = useState<MaestroFlow[]>(() => loadLibrary())
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(flow))
  }, [flow])

  useEffect(() => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
  }, [library])

  /** Select an action only when it still exists in the current flow. */
  const selectAction = useCallback(
    (actionId: string | null) => {
      if (!actionId) {
        setSelectedActionId(null)
        return
      }
      setSelectedActionId(
        findMaestroFlowAction(flow.actions, actionId) ? actionId : null,
      )
    },
    [flow.actions],
  )

  const clearSelection = useCallback(() => {
    setSelectedActionId(null)
  }, [])

  const updateFlow = useCallback(
    (patch: Partial<Omit<MaestroFlow, 'actions'>>) => {
      setFlow((current) => ({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  const addAction = useCallback(
    (command: MaestroCommandId, selector?: MaestroBuilderSelector) => {
      const action = createMaestroFlowAction(command, selector)
      setSelectedActionId(action.id)
      setFlow((current) => ({
        ...current,
        actions: [...current.actions, action],
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  // These four operate by action id regardless of nesting depth — a repeat/
  // retry's nested children are just as addressable as top-level actions,
  // via updateMaestroFlowAction's recursive tree walk.
  const updateAction = useCallback(
    (actionId: string, patch: Partial<MaestroFlowAction>) => {
      setFlow((current) => ({
        ...current,
        actions: updateMaestroFlowAction(
          current.actions,
          actionId,
          (action) => ({ ...action, ...patch }),
        ),
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  const updateActionConfigField = useCallback(
    (
      actionId: string,
      fieldName: string,
      value: string | number | boolean | undefined,
    ) => {
      setFlow((current) => ({
        ...current,
        actions: updateMaestroFlowAction(
          current.actions,
          actionId,
          (action) => {
            const config = { ...action.config }
            if (value === undefined) delete config[fieldName]
            else config[fieldName] = value
            return { ...action, config }
          },
        ),
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  const updateActionSelector = useCallback(
    (actionId: string, selector: MaestroBuilderSelector) => {
      updateAction(actionId, { selector })
    },
    [updateAction],
  )

  const toggleActionEnabled = useCallback((actionId: string) => {
    setFlow((current) => ({
      ...current,
      actions: updateMaestroFlowAction(current.actions, actionId, (action) => ({
        ...action,
        enabled: !action.enabled,
      })),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const addChildAction = useCallback(
    (
      parentActionId: string,
      command: MaestroCommandId,
      selector?: MaestroBuilderSelector,
    ) => {
      const child = createMaestroFlowAction(command, selector)
      const result = addMaestroChildActionWithResult(
        flow.actions,
        parentActionId,
        child,
      )
      if (result.childId) setSelectedActionId(result.childId)
      if (result.childId) {
        setFlow({
          ...flow,
          actions: result.actions,
          updatedAt: new Date().toISOString(),
        })
      }
    },
    [flow],
  )

  const moveAction = useCallback(
    (actionId: string, direction: 'up' | 'down') => {
      setFlow((current) => ({
        ...current,
        actions: moveMaestroFlowAction(current.actions, actionId, direction),
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  const duplicateAction = useCallback(
    (actionId: string) => {
      const result = duplicateMaestroFlowActionWithResult(
        flow.actions,
        actionId,
      )
      if (!result.duplicatedActionId) return
      setSelectedActionId(result.duplicatedActionId)
      setFlow({
        ...flow,
        actions: result.actions,
        updatedAt: new Date().toISOString(),
      })
    },
    [flow],
  )

  const removeAction = useCallback(
    (actionId: string) => {
      const result = removeMaestroFlowActionWithResult(flow.actions, actionId)
      if (result.removedActionIds.length === 0) return
      if (
        selectedActionId &&
        result.removedActionIds.includes(selectedActionId)
      ) {
        const nextSelection = result.nextSelectionId
        setSelectedActionId(
          nextSelection && findMaestroFlowAction(result.actions, nextSelection)
            ? nextSelection
            : null,
        )
      }
      setFlow({
        ...flow,
        actions: result.actions,
        updatedAt: new Date().toISOString(),
      })
    },
    [flow, selectedActionId],
  )

  const newFlow = useCallback(() => {
    setSelectedActionId(null)
    setFlow(createEmptyMaestroFlow(defaultAppId, 'New Flow'))
  }, [defaultAppId])

  const newFlowFromTemplate = useCallback(
    (templateId: MaestroTemplateId) => {
      setSelectedActionId(null)
      setFlow(createMaestroFlowFromTemplate(templateId, defaultAppId))
    },
    [defaultAppId],
  )

  const saveFlow = useCallback(() => {
    const saved: MaestroFlow = { ...flow, updatedAt: new Date().toISOString() }
    setFlow(saved)
    setLibrary((current) => {
      const exists = current.some((item) => item.id === saved.id)
      return exists
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...current, saved]
    })
    return saved
  }, [flow])

  const loadFlow = useCallback((id: string) => {
    setSelectedActionId(null)
    setLibrary((current) => {
      const target = current.find((item) => item.id === id)
      if (target) setFlow(target)
      return current
    })
  }, [])

  const deleteFlow = useCallback((id: string) => {
    setLibrary((current) => current.filter((item) => item.id !== id))
  }, [])

  const duplicateFlow = useCallback(() => {
    const now = new Date().toISOString()
    const copy: MaestroFlow = {
      ...flow,
      id: `maestro-flow-${Date.now().toString(36)}`,
      name: `${flow.name} copy`,
      createdAt: now,
      updatedAt: now,
    }
    setFlow(copy)
    setLibrary((current) => [...current, copy])
  }, [flow])

  const importFlow = useCallback((imported: MaestroFlow) => {
    setSelectedActionId(null)
    setFlow(imported)
  }, [])

  const yaml = useMemo(() => buildMaestroBuilderYaml(flow), [flow])
  const issues: MaestroValidationIssue[] = useMemo(
    () => validateMaestroBuilderFlow(flow),
    [flow],
  )

  return {
    flow,
    library,
    selectedActionId,
    selectAction,
    clearSelection,
    setSelectedActionId,
    yaml,
    issues,
    isValid: issues.length === 0,
    updateFlow,
    addAction,
    addChildAction,
    updateAction,
    updateActionConfigField,
    updateActionSelector,
    toggleActionEnabled,
    moveAction,
    duplicateAction,
    removeAction,
    newFlow,
    newFlowFromTemplate,
    saveFlow,
    loadFlow,
    deleteFlow,
    duplicateFlow,
    importFlow,
  }
}
