import type { MaestroActionKind } from '../types/maestro'

export type MaestroCommandCategory =
  | 'Interaction'
  | 'Assertion'
  | 'App'
  | 'Device'
  | 'Flow control'
  | 'Media'
  | 'AI'

export interface MaestroCommandDefinition {
  command: string
  name: string
  category: MaestroCommandCategory
  description: string
  template: string
  structuredKind?: MaestroActionKind
  destructive?: boolean
}

const command = (
  commandName: string,
  category: MaestroCommandCategory,
  description: string,
  template: string,
  structuredKind?: MaestroActionKind,
  destructive = false,
): MaestroCommandDefinition => ({
  command: commandName,
  name: commandName,
  category,
  description,
  template,
  structuredKind,
  destructive,
})

/** Catalog mirrored from Maestro's official Commands Available reference. */
export const MAESTRO_COMMAND_CATALOG: MaestroCommandDefinition[] = [
  command('addMedia', 'Media', 'Add images or video to the device media library.', '- addMedia:\n    - "path/to/image.png"'),
  command('assertNoDefectsWithAI', 'AI', 'Ask Maestro AI to detect visual defects.', '- assertNoDefectsWithAI:\n    optional: true'),
  command('assertNotVisible', 'Assertion', 'Assert that an element is not visible.', '- assertNotVisible:\n    text: "Element text"'),
  command('assertScreenshot', 'Assertion', 'Compare the current screen with a reference image.', '- assertScreenshot:\n    path: "reference.png"\n    thresholdPercentage: 95'),
  command('assertTrue', 'Assertion', 'Assert that a JavaScript expression is truthy.', '- assertTrue:\n    condition: ${output.value == true}\n    label: "Expected condition"'),
  command('assertVisible', 'Assertion', 'Assert that an element is visible.', '- assertVisible:\n    text: "Element text"', 'assertVisible'),
  command('assertWithAI', 'AI', 'Validate the screen with a natural-language AI assertion.', '- assertWithAI:\n    assertion: "The expected screen is visible"\n    optional: true'),
  command('back', 'Interaction', 'Navigate back using the platform back action.', '- back'),
  command('clearKeychain', 'App', 'Clear iOS Keychain data.', '- clearKeychain', undefined, true),
  command('clearState', 'App', 'Clear app data, cache, and preferences.', '- clearState', undefined, true),
  command('copyTextFrom', 'Interaction', 'Copy text from a selected element.', '- copyTextFrom:\n    text: "Element text"'),
  command('doubleTapOn', 'Interaction', 'Double-tap a selected element.', '- doubleTapOn:\n    text: "Element text"'),
  command('eraseText', 'Interaction', 'Erase characters from the focused text field.', '- eraseText: 10'),
  command('evalScript', 'Flow control', 'Evaluate an inline JavaScript expression.', '- evalScript: ${output.value = "example"}'),
  command('extendedWaitUntil', 'Flow control', 'Wait for an element condition with a custom timeout.', '- extendedWaitUntil:\n    visible:\n      text: "Element text"\n    timeout: 20000', 'waitFor'),
  command('extractTextWithAI', 'AI', 'Extract visible text into a variable using AI.', '- extractTextWithAI:\n    query: "Text to extract"\n    outputVariable: "aiOutput"\n    optional: true'),
  command('hideKeyboard', 'Interaction', 'Hide the software keyboard.', '- hideKeyboard'),
  command('inputText', 'Interaction', 'Type text into the focused field.', '- inputText: "Example text"', 'inputText'),
  command('killApp', 'App', 'Kill the app process without clearing its data.', '- killApp'),
  command('launchApp', 'App', 'Launch, restart, or resume the app under test.', '- launchApp:\n    stopApp: true', 'launchApp'),
  command('longPressOn', 'Interaction', 'Long-press a selected element.', '- longPressOn:\n    text: "Element text"'),
  command('openLink', 'Interaction', 'Open a deep link or web URL.', '- openLink: "https://example.com"'),
  command('pasteText', 'Interaction', 'Paste the Maestro clipboard into the focused field.', '- pasteText'),
  command('pressKey', 'Interaction', 'Press a device key such as Home, Back, or Enter.', '- pressKey: Back', 'pressKey'),
  command('repeat', 'Flow control', 'Repeat nested commands a fixed number of times or while a condition holds.', '- repeat:\n    times: 3\n    commands:\n      - tapOn: "Button"'),
  command('retry', 'Flow control', 'Retry nested commands when they fail.', '- retry:\n    maxRetries: 3\n    commands:\n      - tapOn: "Refresh"'),
  command('runFlow', 'Flow control', 'Run another Maestro YAML flow.', '- runFlow: "path/to/subflow.yaml"'),
  command('runScript', 'Flow control', 'Run a JavaScript file in the Maestro sandbox.', '- runScript: "path/to/script.js"'),
  command('scroll', 'Interaction', 'Scroll the current view.', '- scroll'),
  command('scrollUntilVisible', 'Interaction', 'Scroll until an element becomes visible.', '- scrollUntilVisible:\n    element:\n      text: "Element text"\n    direction: DOWN\n    timeout: 20000'),
  command('setAirplaneMode', 'Device', 'Enable or disable airplane mode.', '- setAirplaneMode: enabled'),
  command('setClipboard', 'Device', 'Set Maestro clipboard text.', '- setClipboard: "Clipboard text"'),
  command('setLocation', 'Device', 'Set a mocked device latitude and longitude.', '- setLocation:\n    latitude: 13.7563\n    longitude: 100.5018'),
  command('setOrientation', 'Device', 'Set portrait or landscape orientation.', '- setOrientation: LANDSCAPE'),
  command('setPermissions', 'App', 'Grant or deny app permissions.', '- setPermissions:\n    permissions:\n      all: allow'),
  command('startRecording', 'Media', 'Start recording the device screen.', '- startRecording: "test-recording"'),
  command('stopApp', 'App', 'Stop the app under test.', '- stopApp'),
  command('stopRecording', 'Media', 'Stop the active screen recording.', '- stopRecording'),
  command('swipe', 'Interaction', 'Swipe in a direction or between coordinates.', '- swipe:\n    direction: UP'),
  command('takeScreenshot', 'Media', 'Capture a named screenshot artifact.', '- takeScreenshot: "checkpoint"', 'screenshot'),
  command('tapOn', 'Interaction', 'Tap an element by visible text or resource ID.', '- tapOn:\n    text: "Element text"', 'tapOn'),
  command('toggleAirplaneMode', 'Device', 'Toggle the current airplane-mode state.', '- toggleAirplaneMode'),
  command('travel', 'Device', 'Mock movement through geographic points at a configured speed.', '- travel:\n    points:\n      - "13.7563, 100.5018"\n      - "13.7466, 100.5347"\n    speed: 1000'),
  command('waitForAnimationToEnd', 'Flow control', 'Wait until on-screen animation settles.', '- waitForAnimationToEnd:\n    timeout: 15000', 'waitForAnimation'),
]

export const MAESTRO_COMMAND_CATEGORIES: MaestroCommandCategory[] = [
  'Interaction',
  'Assertion',
  'App',
  'Device',
  'Flow control',
  'Media',
  'AI',
]

export function findMaestroCommand(commandName: string): MaestroCommandDefinition | undefined {
  return MAESTRO_COMMAND_CATALOG.find((item) => item.command === commandName)
}
