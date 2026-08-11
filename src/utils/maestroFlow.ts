import type {
  MaestroAction,
  MaestroActionKind,
  MaestroSelectorType,
} from '../types/maestro'

export const MAESTRO_ACTION_LABELS: Record<MaestroActionKind, string> = {
  launchApp: 'Launch app',
  tapOn: 'Tap element',
  inputText: 'Input text',
  assertVisible: 'Assert visible',
  waitFor: 'Wait for element',
  waitForAnimation: 'Wait for animation',
  pressKey: 'Press key',
  screenshot: 'Screenshot',
  customYaml: 'Custom YAML',
}

let actionSequence = 0

function actionId(): string {
  actionSequence += 1
  return `maestro-action-${Date.now().toString(36)}-${actionSequence}`
}

export function createMaestroAction<K extends MaestroActionKind>(
  kind: K,
): Extract<MaestroAction, { kind: K }> {
  const id = actionId()
  switch (kind) {
    case 'launchApp': return { id, kind, stopApp: true } as Extract<MaestroAction, { kind: K }>
    case 'tapOn': return { id, kind, selectorType: 'text', value: '' } as Extract<MaestroAction, { kind: K }>
    case 'inputText': return { id, kind, value: '' } as Extract<MaestroAction, { kind: K }>
    case 'assertVisible': return { id, kind, selectorType: 'text', value: '' } as Extract<MaestroAction, { kind: K }>
    case 'waitFor': return { id, kind, selectorType: 'text', value: '', timeoutMs: 20_000 } as Extract<MaestroAction, { kind: K }>
    case 'waitForAnimation': return { id, kind } as Extract<MaestroAction, { kind: K }>
    case 'pressKey': return { id, kind, key: 'Back' } as Extract<MaestroAction, { kind: K }>
    case 'screenshot': return { id, kind, name: 'checkpoint' } as Extract<MaestroAction, { kind: K }>
    case 'customYaml': return {
      id,
      kind,
      label: 'Custom command',
      yaml: '- scroll',
    } as Extract<MaestroAction, { kind: K }>
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ''))
}

function selectorLine(type: MaestroSelectorType, value: string): string {
  return `      ${type}: ${yamlString(value)}`
}

export function validateMaestroFlow(appId: string, actions: MaestroAction[]): string | null {
  if (!/^[A-Za-z0-9_.]+$/.test(appId.trim())) return 'Enter a valid Android package name.'
  if (actions.length === 0) return 'Add at least one action.'
  for (const action of actions) {
    if ('value' in action && !action.value.trim()) {
      return `${MAESTRO_ACTION_LABELS[action.kind]} requires a value.`
    }
    if (action.kind === 'screenshot' && !action.name.trim()) {
      return 'Screenshot requires a name.'
    }
    if (action.kind === 'waitFor' && (!Number.isFinite(action.timeoutMs) || action.timeoutMs < 100)) {
      return 'Wait timeout must be at least 100 ms.'
    }
    if (action.kind === 'customYaml') {
      const custom = action.yaml.trim()
      if (!action.label.trim()) return 'Custom YAML requires a label.'
      if (custom.length > 20_000) return 'Custom YAML must be 20 KB or smaller.'
      if (/^\s*(?:(?:appId|url|name|tags|env)\s*:|---\s*$)/m.test(custom)) {
        return 'Custom YAML accepts command blocks only, not a Flow header.'
      }
      if (!custom.startsWith('- ')) return 'Custom YAML must start with a Maestro command such as "- scroll".'
    }
  }
  return null
}

export function buildMaestroYaml(
  appId: string,
  name: string,
  actions: MaestroAction[],
): string {
  const lines = [
    `appId: ${yamlString(appId.trim())}`,
    `name: ${yamlString(name.trim() || 'Mobile flow')}`,
    '---',
  ]
  for (const action of actions) {
    switch (action.kind) {
      case 'launchApp':
        lines.push('- launchApp:', `    stopApp: ${action.stopApp}`)
        break
      case 'tapOn':
        lines.push('- tapOn:', selectorLine(action.selectorType, action.value))
        break
      case 'inputText':
        lines.push(`- inputText: ${yamlString(action.value)}`)
        break
      case 'assertVisible':
        lines.push('- assertVisible:', selectorLine(action.selectorType, action.value))
        break
      case 'waitFor':
        lines.push(
          '- extendedWaitUntil:',
          '    visible:',
          `      ${action.selectorType}: ${yamlString(action.value)}`,
          `    timeout: ${Math.round(action.timeoutMs)}`,
        )
        break
      case 'waitForAnimation':
        lines.push('- waitForAnimationToEnd')
        break
      case 'pressKey':
        lines.push(`- pressKey: ${action.key}`)
        break
      case 'screenshot':
        lines.push(`- takeScreenshot: ${yamlString(action.name)}`)
        break
      case 'customYaml':
        lines.push(`# Custom action: ${action.label.replace(/[\r\n#]+/g, ' ').trim()}`)
        lines.push(...action.yaml.trim().split(/\r?\n/))
        break
    }
  }
  return `${lines.join('\n')}\n`
}

export function createWashXpressActions(): MaestroAction[] {
  const surface = '.*(WashXpress|เข้าสู่ระบบ|Login|ค้นหาสาขา|สาขาใกล้คุณ|ซัก|อบ).*'
  return [
    { ...createMaestroAction('launchApp'), stopApp: true },
    createMaestroAction('waitForAnimation'),
    { ...createMaestroAction('waitFor'), value: surface, timeoutMs: 20_000 },
    { ...createMaestroAction('assertVisible'), value: surface },
    { ...createMaestroAction('screenshot'), name: 'washxpress-cold-launch' },
    { ...createMaestroAction('pressKey'), key: 'Home' },
    { ...createMaestroAction('launchApp'), stopApp: false },
    { ...createMaestroAction('assertVisible'), value: surface },
    { ...createMaestroAction('screenshot'), name: 'washxpress-resumed' },
  ]
}
