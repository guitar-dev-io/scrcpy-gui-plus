import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUiInspector } from './useUiInspector'
import { CompanionInspectorContext } from '../contexts/CompanionInspectorContext'

vi.mock('../services/uiInspectorService', () => ({
  dumpUiHierarchy: vi.fn(),
  captureScreenBase64: vi.fn(),
}))

const OriginalImage = globalThis.Image

afterEach(() => {
  globalThis.Image = OriginalImage
})

describe('useUiInspector with a Companion source', () => {
  it('reads the frame and ui_dump from the Companion when no adb device is selected', async () => {
    // jsdom does not decode images; report a fixed frame size.
    globalThis.Image = class {
      naturalWidth = 540
      naturalHeight = 1200
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    } as unknown as typeof Image

    const request = vi.fn(async () => ({
      xml: '<hierarchy rotation="0"><node index="0" text="Login" resource-id="app:id/login" class="android.widget.Button" package="app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][540,1200]" /></hierarchy>',
    }))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CompanionInspectorContext.Provider
        value={{ name: 'Pixel', request: request as never, getFrame: () => 'data:image/jpeg;base64,AAAA' }}
      >
        {children}
      </CompanionInspectorContext.Provider>
    )

    const { result } = renderHook(
      () => useUiInspector({ activeDevice: '', enabled: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.root).not.toBeNull())
    expect(request).toHaveBeenCalledWith('ui_dump', { targetWidth: 540, targetHeight: 1200 })
    expect(result.current.source).toBe('companion')
    expect(result.current.screenshot).toBe('data:image/jpeg;base64,AAAA')
  })
})
