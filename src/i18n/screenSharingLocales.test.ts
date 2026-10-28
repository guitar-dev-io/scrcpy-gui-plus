import { describe, expect, it } from 'vitest'
import { en } from './locales/en'
import { fr } from './locales/fr'
import { id } from './locales/id'
import { ptBR } from './locales/pt-BR'
import { ru } from './locales/ru'
import { th } from './locales/th'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'

const locales = { fr, id, 'pt-BR': ptBR, ru, th, 'zh-CN': zhCN, 'zh-TW': zhTW }
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
const english = en.screenSharing as Record<string, string>

describe('screen sharing translations', () => {
  it('has English text for every key', () => {
    for (const [key, text] of Object.entries(english)) {
      expect(text, key).toBeTruthy()
    }
  })

  for (const [name, bundle] of Object.entries(locales)) {
    it(`${name} translates every key and keeps the placeholders`, () => {
      const translated = (bundle as { screenSharing?: Record<string, string> }).screenSharing
      expect(translated, `${name} has no screenSharing block`).toBeDefined()
      expect(Object.keys(translated!).sort()).toEqual(Object.keys(english).sort())
      for (const [key, text] of Object.entries(translated!)) {
        expect(text.trim(), `${name}.${key} is empty`).not.toBe('')
        expect(placeholders(text), `${name}.${key} placeholders`).toEqual(placeholders(english[key]))
      }
    })
  }

  it('actually translates (no locale simply repeats the English text)', () => {
    for (const [name, bundle] of Object.entries(locales)) {
      const translated = (bundle as { screenSharing: Record<string, string> }).screenSharing
      expect(translated.confirmBody, name).not.toBe(english.confirmBody)
      expect(translated.start, name).not.toBe(english.start)
    }
  })
})
