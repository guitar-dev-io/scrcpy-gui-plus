import { describe, expect, it } from 'vitest'
import {
  buildMaestroYaml,
  createMaestroAction,
  createWashXpressActions,
  validateMaestroFlow,
} from './maestroFlow'

describe('Maestro flow builder', () => {
  it('builds the bundled WashXpress actions as valid Maestro commands', () => {
    const yaml = buildMaestroYaml(
      'com.laundryyou.washxpress',
      'WashXpress smoke',
      createWashXpressActions(),
    )
    expect(yaml).toContain('appId: "com.laundryyou.washxpress"')
    expect(yaml).toContain('- launchApp:')
    expect(yaml).toContain('- extendedWaitUntil:')
    expect(yaml).toContain('- assertVisible:')
    expect(yaml).toContain('- takeScreenshot: "washxpress-resumed"')
  })

  it('escapes user-controlled values without creating YAML commands', () => {
    const action = { ...createMaestroAction('inputText'), value: 'hello\n- clearState' }
    const yaml = buildMaestroYaml('com.example.app', 'Safe', [action])
    expect(yaml).toContain('inputText: "hello\\n- clearState"')
    expect(yaml).not.toContain('\n- clearState\n')
  })

  it('validates package names and required action values', () => {
    expect(validateMaestroFlow('bad package', [createMaestroAction('launchApp')])).toMatch(/package/i)
    expect(validateMaestroFlow('com.example.app', [createMaestroAction('tapOn')])).toMatch(/value/i)
  })

  it('supports any advanced Maestro command through Custom YAML', () => {
    const action = {
      ...createMaestroAction('customYaml'),
      label: 'Retry flaky refresh',
      yaml: '- retry:\n    maxRetries: 3\n    commands:\n      - tapOn: "Refresh"',
    }
    expect(validateMaestroFlow('com.example.app', [action])).toBeNull()
    const yaml = buildMaestroYaml('com.example.app', 'Advanced', [action])
    expect(yaml).toContain('# Custom action: Retry flaky refresh')
    expect(yaml).toContain('- retry:\n    maxRetries: 3')
  })

  it('rejects Flow headers inside a Custom YAML action', () => {
    const action = {
      ...createMaestroAction('customYaml'),
      yaml: 'appId: evil.example\n---\n- clearState',
    }
    expect(validateMaestroFlow('com.example.app', [action])).toMatch(/command blocks/i)
  })
})
