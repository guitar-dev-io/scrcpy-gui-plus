// Schema-driven Maestro command registry for the visual Flow Builder.
//
// Adding a command here (data only) is enough for it to appear in the Action
// Library and be usable by a generic action-card renderer — no bespoke React
// component per command. See docs/redesign/script-management.md
// ("COMMAND REGISTRY").
//
// This is a deliberately practical subset of Maestro's command set (the ones
// useful inside a structured Flow Builder action card), not an exhaustive
// mirror of every CLI command. `repeat`/`retry` (via `requiresChildren`, see
// maestroBuilderSerializer.ts) and `runFlow`/`runScript` are supported; AI
// commands (gated behind Maestro version detection, not yet verified) are
// intentionally deferred.
import type {
  MaestroBuilderSelector,
  MaestroCommandDefinition,
  MaestroCommandId,
} from '../types/maestroBuilder'

/** Sentinel command id used to preserve an unrecognized YAML block verbatim. */
export const UNSUPPORTED_COMMAND_ID = '__unsupported__'

export const MAESTRO_COMMAND_REGISTRY: MaestroCommandDefinition[] = [
  // Common (pinned)
  {
    id: 'launchApp',
    label: 'Launch App',
    description: 'Launch, restart, or resume the app under test.',
    category: 'appState',
    common: true,
    fields: [
      { name: 'stopApp', label: 'Stop app first', type: 'boolean', optional: true, defaultValue: true },
    ],
  },
  {
    id: 'tapOn',
    label: 'Tap Element',
    description: 'Tap on a selected element.',
    category: 'interaction',
    common: true,
    requiresElement: true,
    supportedSelectors: ['id', 'text', 'index', 'point'],
    fields: [],
  },
  {
    id: 'inputText',
    label: 'Input Text',
    description: 'Type text into the focused field.',
    category: 'input',
    common: true,
    bareValueField: 'value',
    fields: [{ name: 'value', label: 'Text', type: 'text' }],
  },
  {
    id: 'assertVisible',
    label: 'Assert Visible',
    description: 'Assert that an element is visible.',
    category: 'assertion',
    common: true,
    requiresElement: true,
    supportedSelectors: ['id', 'text', 'index'],
    fields: [],
  },
  {
    id: 'waitFor',
    label: 'Wait For Element',
    description: 'Wait for an element to become visible, with a custom timeout.',
    category: 'common',
    common: true,
    requiresElement: true,
    supportedSelectors: ['id', 'text'],
    fields: [
      { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', defaultValue: 20_000, min: 1 },
    ],
    serialize: (action) => {
      const timeout = Number(action.config.timeoutMs ?? 20_000)
      const selectorLine = action.selector
        ? `      ${action.selector.type}: ${yamlString(action.selector.value)}`
        : '      text: ""'
      return [
        '- extendedWaitUntil:',
        '    visible:',
        selectorLine,
        ...buildSelectorRelationLines(action.selector, '      '),
        `    timeout: ${Math.round(timeout)}`,
      ]
    },
  },
  {
    id: 'takeScreenshot',
    label: 'Screenshot',
    description: 'Capture a named screenshot artifact.',
    category: 'media',
    common: true,
    bareValueField: 'name',
    fields: [{ name: 'name', label: 'Name', type: 'text' }],
  },

  // Interaction
  {
    id: 'doubleTapOn',
    label: 'Double Tap',
    description: 'Double-tap a selected element.',
    category: 'interaction',
    requiresElement: true,
    supportedSelectors: ['id', 'text', 'index', 'point'],
    fields: [],
  },
  {
    id: 'longPressOn',
    label: 'Long Press',
    description: 'Long-press a selected element.',
    category: 'interaction',
    requiresElement: true,
    supportedSelectors: ['id', 'text', 'index', 'point'],
    fields: [],
  },
  {
    id: 'back',
    label: 'Back',
    description: 'Navigate back using the platform back action.',
    category: 'interaction',
    fields: [],
  },
  {
    id: 'pressKey',
    label: 'Press Key',
    description: 'Press a device key.',
    category: 'interaction',
    bareValueField: 'key',
    fields: [
      {
        name: 'key',
        label: 'Key',
        type: 'select',
        defaultValue: 'Back',
        options: [
          { value: 'Home', label: 'Home' },
          { value: 'Back', label: 'Back' },
          { value: 'Enter', label: 'Enter' },
          { value: 'Lock', label: 'Lock' },
          { value: 'VolumeUp', label: 'Volume Up' },
          { value: 'VolumeDown', label: 'Volume Down' },
        ],
      },
    ],
  },
  {
    id: 'copyTextFrom',
    label: 'Copy Text',
    description: 'Copy text from a selected element into the Maestro clipboard.',
    category: 'interaction',
    requiresElement: true,
    supportedSelectors: ['id', 'text'],
    fields: [],
  },
  {
    id: 'hideKeyboard',
    label: 'Hide Keyboard',
    description: 'Hide the software keyboard.',
    category: 'interaction',
    fields: [],
  },
  {
    id: 'pasteText',
    label: 'Paste Text',
    description: 'Paste the Maestro clipboard into the focused field.',
    category: 'input',
    fields: [],
  },
  {
    id: 'eraseText',
    label: 'Erase Text',
    description: 'Erase characters from the focused text field.',
    category: 'input',
    bareValueField: 'characters',
    fields: [
      { name: 'characters', label: 'Characters', type: 'number', optional: true, defaultValue: 10, min: 1 },
    ],
  },

  // Assertions
  {
    id: 'assertNotVisible',
    label: 'Assert Not Visible',
    description: 'Assert that an element is not visible.',
    category: 'assertion',
    requiresElement: true,
    supportedSelectors: ['id', 'text'],
    fields: [],
  },
  {
    id: 'assertTrue',
    label: 'Assert True',
    description: 'Assert that a JavaScript expression is truthy.',
    category: 'assertion',
    fields: [{ name: 'condition', label: 'Condition', type: 'text' }],
    serialize: (action) => [
      '- assertTrue:',
      `    condition: ${yamlString(String(action.config.condition ?? ''))}`,
    ],
  },

  // Gestures
  {
    id: 'scroll',
    label: 'Scroll',
    description: 'Scroll the current view.',
    category: 'gesture',
    fields: [],
  },
  {
    id: 'scrollUntilVisible',
    label: 'Scroll Until Visible',
    description: 'Scroll until an element becomes visible.',
    category: 'gesture',
    common: true,
    requiresElement: true,
    supportedSelectors: ['id', 'text'],
    fields: [
      {
        name: 'direction',
        label: 'Direction',
        type: 'select',
        defaultValue: 'DOWN',
        options: [
          { value: 'DOWN', label: 'Down' },
          { value: 'UP', label: 'Up' },
          { value: 'LEFT', label: 'Left' },
          { value: 'RIGHT', label: 'Right' },
        ],
      },
      { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', defaultValue: 20_000, min: 1 },
    ],
    serialize: (action) => {
      const direction = String(action.config.direction ?? 'DOWN')
      const timeout = Number(action.config.timeoutMs ?? 20_000)
      const selectorLine = action.selector
        ? `      ${action.selector.type}: ${yamlString(action.selector.value)}`
        : '      text: ""'
      return [
        '- scrollUntilVisible:',
        '    element:',
        selectorLine,
        ...buildSelectorRelationLines(action.selector, '      '),
        `    direction: ${direction}`,
        `    timeout: ${Math.round(timeout)}`,
      ]
    },
  },
  {
    id: 'swipe',
    label: 'Swipe',
    description: 'Swipe in a direction.',
    category: 'gesture',
    bareValueField: 'direction',
    fields: [
      {
        name: 'direction',
        label: 'Direction',
        type: 'select',
        defaultValue: 'UP',
        options: [
          { value: 'UP', label: 'Up' },
          { value: 'DOWN', label: 'Down' },
          { value: 'LEFT', label: 'Left' },
          { value: 'RIGHT', label: 'Right' },
        ],
      },
    ],
    serialize: (action) => ['- swipe:', `    direction: ${String(action.config.direction ?? 'UP')}`],
  },

  // App & State
  {
    id: 'stopApp',
    label: 'Stop App',
    description: 'Stop the app under test.',
    category: 'appState',
    fields: [],
  },
  {
    id: 'killApp',
    label: 'Kill App',
    description: 'Kill the app process without clearing its data.',
    category: 'appState',
    fields: [],
  },
  {
    id: 'clearState',
    label: 'Clear State',
    description: 'Clear app data, cache, and preferences.',
    category: 'appState',
    fields: [],
  },
  {
    id: 'clearKeychain',
    label: 'Clear Keychain',
    description: 'Clear iOS Keychain data.',
    category: 'appState',
    fields: [],
  },
  {
    id: 'openLink',
    label: 'Open Link',
    description: 'Open a deep link or web URL.',
    category: 'appState',
    bareValueField: 'url',
    fields: [{ name: 'url', label: 'URL', type: 'text' }],
  },

  // Device
  {
    id: 'setLocation',
    label: 'Set Location',
    description: 'Set a mocked device latitude and longitude.',
    category: 'device',
    fields: [
      { name: 'latitude', label: 'Latitude', type: 'number', min: -90, max: 90 },
      { name: 'longitude', label: 'Longitude', type: 'number', min: -180, max: 180 },
    ],
    serialize: (action) => [
      '- setLocation:',
      `    latitude: ${Number(action.config.latitude ?? 0)}`,
      `    longitude: ${Number(action.config.longitude ?? 0)}`,
    ],
  },
  {
    id: 'setOrientation',
    label: 'Set Orientation',
    description: 'Set portrait or landscape orientation.',
    category: 'device',
    bareValueField: 'orientation',
    fields: [
      {
        name: 'orientation',
        label: 'Orientation',
        type: 'select',
        defaultValue: 'PORTRAIT',
        options: [
          { value: 'PORTRAIT', label: 'Portrait' },
          { value: 'LANDSCAPE', label: 'Landscape' },
        ],
      },
    ],
  },
  {
    id: 'setAirplaneMode',
    label: 'Set Airplane Mode',
    description: 'Enable or disable airplane mode.',
    category: 'device',
    bareValueField: 'mode',
    fields: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        defaultValue: 'enabled',
        options: [
          { value: 'enabled', label: 'Enabled' },
          { value: 'disabled', label: 'Disabled' },
        ],
      },
    ],
  },
  {
    id: 'toggleAirplaneMode',
    label: 'Toggle Airplane Mode',
    description: 'Toggle the current airplane-mode state.',
    category: 'device',
    fields: [],
  },
  {
    id: 'setClipboard',
    label: 'Set Clipboard',
    description: 'Set the Maestro clipboard text.',
    category: 'device',
    bareValueField: 'value',
    fields: [{ name: 'value', label: 'Text', type: 'text' }],
  },

  // Media & Debug
  {
    id: 'startRecording',
    label: 'Start Recording',
    description: 'Start recording the device screen.',
    category: 'media',
    bareValueField: 'name',
    fields: [{ name: 'name', label: 'Name', type: 'text', optional: true }],
  },
  {
    id: 'stopRecording',
    label: 'Stop Recording',
    description: 'Stop the active screen recording.',
    category: 'media',
    fields: [],
  },
  {
    id: 'waitForAnimationToEnd',
    label: 'Wait For Animation',
    description: 'Wait until on-screen animation settles.',
    category: 'gesture',
    fields: [{ name: 'timeoutMs', label: 'Timeout (ms)', type: 'number', optional: true, min: 1 }],
    serialize: (action) => {
      const raw = action.config.timeoutMs
      if (raw === undefined || raw === '') return ['- waitForAnimationToEnd']
      return ['- waitForAnimationToEnd:', `    timeout: ${Math.round(Number(raw))}`]
    },
  },
  // Flow control
  {
    id: 'repeat',
    label: 'Repeat',
    description: 'Repeat nested actions a fixed number of times.',
    category: 'flowControl',
    requiresChildren: true,
    fields: [{ name: 'times', label: 'Times', type: 'number', defaultValue: 2, min: 1 }],
  },
  {
    id: 'retry',
    label: 'Retry',
    description: 'Retry nested actions on failure, up to a maximum number of attempts.',
    category: 'flowControl',
    requiresChildren: true,
    fields: [{ name: 'maxRetries', label: 'Max retries', type: 'number', defaultValue: 3, min: 1 }],
  },
  {
    id: 'runFlow',
    label: 'Run Flow',
    description: 'Run another Maestro flow file.',
    category: 'flowControl',
    bareValueField: 'path',
    fields: [{ name: 'path', label: 'Flow path', type: 'text' }],
  },
  {
    id: 'runScript',
    label: 'Run Script',
    description: 'Run a JavaScript file in the Maestro sandbox.',
    category: 'flowControl',
    bareValueField: 'path',
    fields: [{ name: 'path', label: 'Script path', type: 'text' }],
  },
  // Preserves a command block the registry doesn't understand (e.g. imported
  // YAML using repeat/retry/runFlow/AI commands) verbatim, so import never
  // silently drops data. See "YAML IMPORT" in the redesign spec.
  {
    id: UNSUPPORTED_COMMAND_ID,
    label: 'Unsupported Maestro Command',
    description: 'Preserved exactly as imported. Edit the raw YAML directly.',
    category: 'custom',
    fields: [{ name: 'raw', label: 'YAML', type: 'text' }],
    serialize: (action) => String(action.config.raw ?? '').split('\n'),
  },
]

/** Strip control characters that would break single-line YAML output while keeping tab/newline/CR. */
function sanitizeForYaml(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    const isKeptWhitespace = code === 9 || code === 10 || code === 13
    const isControl = (code <= 31 && !isKeptWhitespace) || code === 127
    if (isControl) continue
    out += ch
  }
  return out
}

export function yamlString(value: string): string {
  return JSON.stringify(sanitizeForYaml(value))
}

/**
 * Renders a selector's relational refinement (above/below/leftOf/rightOf/
 * containsChild/childOf/containsDescendants) as sibling YAML lines under the
 * primary selector, e.g.:
 *   text: "Delete"
 *   childOf:
 *     id: "basket_container"
 * `indent` must match the primary selector line's own indent so the relation
 * key lands as its sibling. Returns [] when there's no relation set, so
 * selectors without one serialize byte-for-byte as before.
 */
export function buildSelectorRelationLines(
  selector: MaestroBuilderSelector | undefined,
  indent: string,
): string[] {
  if (!selector?.relation || !selector.relatedValue?.trim()) return []
  const childIndent = `${indent}  `
  const relatedField = `${selector.type}: ${yamlString(selector.relatedValue)}`
  if (selector.relation === 'containsDescendants') {
    return [`${indent}${selector.relation}:`, `${childIndent}- ${relatedField}`]
  }
  return [`${indent}${selector.relation}:`, `${childIndent}${relatedField}`]
}

const REGISTRY_BY_ID = new Map<MaestroCommandId, MaestroCommandDefinition>(
  MAESTRO_COMMAND_REGISTRY.map((definition) => [definition.id, definition]),
)

export function findMaestroCommandDefinition(
  id: MaestroCommandId,
): MaestroCommandDefinition | undefined {
  return REGISTRY_BY_ID.get(id)
}

export function listMaestroCommandsByCategory(
  category: MaestroCommandDefinition['category'],
): MaestroCommandDefinition[] {
  return MAESTRO_COMMAND_REGISTRY.filter((definition) => definition.category === category)
}

export const MAESTRO_COMMON_COMMANDS: MaestroCommandDefinition[] =
  MAESTRO_COMMAND_REGISTRY.filter((definition) => definition.common)

/** Fuzzy-ish search: matches when the query is a substring of the id, label, or description. */
export function searchMaestroCommands(query: string): MaestroCommandDefinition[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return MAESTRO_COMMAND_REGISTRY
  return MAESTRO_COMMAND_REGISTRY.filter((definition) =>
    [definition.id, definition.label, definition.description]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}
