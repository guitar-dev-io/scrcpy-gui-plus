import type { MaestroFlowAction } from '../types/maestroBuilder'

const NEEDS_SCREEN = new Set(['tapOn', 'doubleTapOn', 'longPressOn', 'inputText', 'assertVisible'])
const FOCUSES_FIELD = new Set(['tapOn', 'doubleTapOn', 'longPressOn', 'inputText', 'eraseText', 'pasteText'])

/**
 * Non-blocking tips for a step, derived from the step before it. They explain the
 * two things that most often make a first real run misbehave: acting before the
 * app has drawn its first screen, and typing into a field that was never focused.
 * Disabled steps are ignored on both sides.
 */
export function stepHints(actions: readonly MaestroFlowAction[], index: number): string[] {
  const action = actions[index]
  if (!action?.enabled) return []
  const previous = actions.slice(0, index).reverse().find((candidate) => candidate.enabled)
  const hints: string[] = []

  if (previous?.command === 'launchApp' && NEEDS_SCREEN.has(action.command)) {
    hints.push('Apps need a few seconds to show their first screen. Add Wait For Element before this step.')
  }
  if (action.command === 'inputText' && previous && !FOCUSES_FIELD.has(previous.command)) {
    hints.push('Tap the field first so the text has somewhere to go.')
  }
  if (action.command === 'tapOn' && action.selector?.type === 'index') {
    hints.push('Index taps the Nth element on screen, which shifts when the screen changes. Prefer Text or ID.')
  }
  return hints
}
