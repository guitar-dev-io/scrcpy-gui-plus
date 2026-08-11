import { describe, expect, it } from 'vitest'
import {
  addMaestroChildAction,
  createMaestroFlowAction,
  duplicateMaestroFlowAction,
  moveMaestroFlowAction,
  removeMaestroFlowAction,
  updateMaestroFlowAction,
} from '../maestroBuilderFlow'

describe('structured Maestro flow mutations', () => {
  it('creates registry defaults and updates an action without mutating the input tree', () => {
    const launch = createMaestroFlowAction('launchApp')
    const input = createMaestroFlowAction('inputText')
    const actions = [launch, input]

    const updated = updateMaestroFlowAction(actions, input.id, (action) => ({
      ...action,
      config: { ...action.config, value: 'hello from the test' },
    }))

    expect(launch.config).toEqual({ stopApp: true })
    expect(input.config).toEqual({})
    expect(updated).not.toBe(actions)
    expect(updated[1]).toMatchObject({
      id: input.id,
      command: 'inputText',
      config: { value: 'hello from the test' },
    })
  })

  it('supports add, update, move, duplicate, and remove for nested children', () => {
    const repeat = createMaestroFlowAction('repeat')
    const firstChild = createMaestroFlowAction('tapOn', {
      type: 'text',
      value: 'First',
    })
    const secondChild = createMaestroFlowAction('assertVisible', {
      type: 'text',
      value: 'Second',
    })
    const actions = addMaestroChildAction([repeat], repeat.id, firstChild)
    const withSecondChild = addMaestroChildAction(
      actions,
      repeat.id,
      secondChild,
    )

    const updatedChildTree = updateMaestroFlowAction(
      withSecondChild,
      firstChild.id,
      (action) => ({
        ...action,
        selector: { type: 'text', value: 'Updated first' },
      }),
    )
    const movedChildren = moveMaestroFlowAction(
      updatedChildTree,
      firstChild.id,
      'down',
    )

    expect(movedChildren[0]?.children?.map((child) => child.id)).toEqual([
      secondChild.id,
      firstChild.id,
    ])
    expect(movedChildren[0]?.children?.[1].selector?.value).toBe('Updated first')

    const duplicated = duplicateMaestroFlowAction(movedChildren, secondChild.id)
    const nestedChildren = duplicated[0]?.children ?? []
    expect(nestedChildren).toHaveLength(3)
    expect(nestedChildren[0].id).toBe(secondChild.id)
    expect(nestedChildren[1].id).not.toBe(secondChild.id)
    expect(nestedChildren[1].selector).toEqual(secondChild.selector)

    const removed = removeMaestroFlowAction(duplicated, nestedChildren[1].id)
    expect(removed[0]?.children).toHaveLength(2)
  })

  it('leaves the original tree unchanged for a missing action id', () => {
    const actions = [createMaestroFlowAction('back')]

    expect(
      updateMaestroFlowAction(actions, 'missing', (action) => ({
        ...action,
        enabled: false,
      })),
    ).toBe(actions)
    expect(moveMaestroFlowAction(actions, 'missing', 'up')).toBe(actions)
    expect(duplicateMaestroFlowAction(actions, 'missing')).toBe(actions)
    expect(removeMaestroFlowAction(actions, 'missing')).toBe(actions)
  })
})
