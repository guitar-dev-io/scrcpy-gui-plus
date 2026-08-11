import { describe, expect, it } from 'vitest'
import { MAESTRO_COMMAND_CATALOG } from './maestroCommandCatalog'

const officialCommands = `addMedia assertNoDefectsWithAI assertNotVisible assertScreenshot assertTrue assertVisible assertWithAI back clearKeychain clearState copyTextFrom doubleTapOn eraseText evalScript extendedWaitUntil extractTextWithAI hideKeyboard inputText killApp launchApp longPressOn openLink pasteText pressKey repeat retry runFlow runScript scroll scrollUntilVisible setAirplaneMode setClipboard setLocation setOrientation setPermissions startRecording stopApp stopRecording swipe takeScreenshot tapOn toggleAirplaneMode travel waitForAnimationToEnd`.split(' ')

describe('Maestro command catalog', () => {
  it('contains every command in the official Commands Available reference', () => {
    expect(MAESTRO_COMMAND_CATALOG.map((item) => item.command).sort()).toEqual(officialCommands.sort())
  })

  it('provides an editable valid-looking command template for every item', () => {
    for (const item of MAESTRO_COMMAND_CATALOG) {
      expect(item.template.trimStart(), item.command).toMatch(new RegExp(`^- ${item.command}(?:[:\\s]|$)`))
      expect(item.description.length, item.command).toBeGreaterThan(10)
    }
  })
})
