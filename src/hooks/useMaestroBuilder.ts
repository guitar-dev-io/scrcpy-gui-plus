import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../types/maestroBuilder'
import {
  createEmptyMaestroFlow,
  createMaestroFlowAction,
  duplicateMaestroFlowAction,
  moveMaestroFlowAction,
  removeMaestroFlowAction,
} from '../utils/maestroBuilderFlow'
import { buildMaestroBuilderYaml } from '../utils/maestroBuilderSerializer'
import { validateMaestroBuilderFlow } from '../utils/maestroBuilderValidator'

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
    () => loadJson<MaestroFlow>(DRAFT_KEY) ?? createEmptyMaestroFlow(defaultAppId, 'New Flow'),
  )
  const [library, setLibrary] = useState<MaestroFlow[]>(() => loadLibrary())

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(flow))
  }, [flow])

  useEffect(() => {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
  }, [library])

  const updateFlow = useCallback((patch: Partial<Omit<MaestroFlow, 'actions'>>) => {
    setFlow((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }, [])

  const addAction = useCallback((command: MaestroCommandId, selector?: MaestroBuilderSelector) => {
    setFlow((current) => ({
      ...current,
      actions: [...current.actions, createMaestroFlowAction(command, selector)],
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateAction = useCallback((actionId: string, patch: Partial<MaestroFlowAction>) => {
    setFlow((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === actionId ? { ...action, ...patch } : action,
      ),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateActionConfigField = useCallback(
    (actionId: string, fieldName: string, value: string | number | boolean | undefined) => {
      setFlow((current) => ({
        ...current,
        actions: current.actions.map((action) => {
          if (action.id !== actionId) return action
          const config = { ...action.config }
          if (value === undefined) delete config[fieldName]
          else config[fieldName] = value
          return { ...action, config }
        }),
        updatedAt: new Date().toISOString(),
      }))
    },
    [],
  )

  const updateActionSelector = useCallback((actionId: string, selector: MaestroBuilderSelector) => {
    updateAction(actionId, { selector })
  }, [updateAction])

  const toggleActionEnabled = useCallback((actionId: string) => {
    setFlow((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === actionId ? { ...action, enabled: !action.enabled } : action,
      ),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const moveAction = useCallback((actionId: string, direction: 'up' | 'down') => {
    setFlow((current) => ({
      ...current,
      actions: moveMaestroFlowAction(current.actions, actionId, direction),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const duplicateAction = useCallback((actionId: string) => {
    setFlow((current) => ({
      ...current,
      actions: duplicateMaestroFlowAction(current.actions, actionId),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const removeAction = useCallback((actionId: string) => {
    setFlow((current) => ({
      ...current,
      actions: removeMaestroFlowAction(current.actions, actionId),
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const newFlow = useCallback(() => {
    setFlow(createEmptyMaestroFlow(defaultAppId, 'New Flow'))
  }, [defaultAppId])

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
    setFlow(imported)
  }, [])

  const yaml = useMemo(() => buildMaestroBuilderYaml(flow), [flow])
  const issues: MaestroValidationIssue[] = useMemo(() => validateMaestroBuilderFlow(flow), [flow])

  return {
    flow,
    library,
    yaml,
    issues,
    isValid: issues.length === 0,
    updateFlow,
    addAction,
    updateAction,
    updateActionConfigField,
    updateActionSelector,
    toggleActionEnabled,
    moveAction,
    duplicateAction,
    removeAction,
    newFlow,
    saveFlow,
    loadFlow,
    deleteFlow,
    duplicateFlow,
    importFlow,
  }
}
