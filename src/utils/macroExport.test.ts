import { describe, expect, it } from 'vitest'
import { toAppiumPython, toMaestroYaml } from './macroExport'
import type { Macro } from '../types/macro'

const macro: Macro = {
  version: 1,
  name: 'Assertions',
  steps: [
    { kind: 'assertText', value: 'Signed in' },
    { kind: 'assertPackage', package: 'com.example.app' },
  ],
}

describe('macro assertion exports', () => {
  it('exports visible text assertions to Maestro', () => {
    const yaml = toMaestroYaml(macro)
    expect(yaml).toContain('- assertVisible: "Signed in"')
    expect(yaml).toContain('assert active package: com.example.app')
  })

  it('exports assertions to Appium Python', () => {
    const python = toAppiumPython(macro)
    expect(python).toContain('contains(@text, \\"Signed in\\")')
    expect(python).toContain('assert driver.current_package == "com.example.app"')
  })

  it('neutralizes newlines in generated comments', () => {
    const malicious: Macro = { ...macro, name: 'safe\n__import__("os").system("bad")' }
    const python = toAppiumPython(malicious)
    expect(python.split('\n')[0]).toContain('# Appium script generated')
    expect(python.split('\n')[1]).toContain('Provide your own driver')
    expect(python).not.toContain('\n__import__')
  })
})
