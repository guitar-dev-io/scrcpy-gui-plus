import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { IJsonModel } from 'flexlayout-react'
import StudioLayout, { type StudioLayoutHandle } from './StudioLayout'

const initialLayout: IJsonModel = {
  global: {
    tabEnableClose: false,
  },
  layout: {
    type: 'row',
    children: [
      {
        type: 'tabset',
        id: 'workspace',
        children: [
          {
            type: 'tab',
            id: 'device-tab',
            name: 'Device',
            component: 'device',
            config: { role: 'primary' },
          },
        ],
      },
    ],
  },
}

describe('StudioLayout', () => {
  beforeAll(() => {
    class TestResizeObserver implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: {
                x: 0,
                y: 0,
                top: 0,
                right: 800,
                bottom: 600,
                left: 0,
                width: 800,
                height: 600,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ],
          this,
        )
      }
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = TestResizeObserver
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 600,
      left: 0,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })
  })

  it('resolves external panel factories without putting app state in the model', () => {
    const panelFactory = vi.fn(({ config }) => (
      <div>Device panel: {(config as { role: string }).role}</div>
    ))

    render(
      <div style={{ width: 800, height: 600 }}>
        <StudioLayout
          initialLayout={initialLayout}
          panels={{ device: panelFactory }}
        />
      </div>,
    )

    expect(screen.getByText('Device panel: primary')).toBeInTheDocument()
    expect(panelFactory).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: 'device' }),
    )
  })

  it('exposes serializable layout state and supports an explicit restore', () => {
    const ref = createRef<StudioLayoutHandle>()
    render(
      <div style={{ width: 800, height: 600 }}>
        <StudioLayout
          ref={ref}
          initialLayout={initialLayout}
          panels={{ device: <div>Device panel</div> }}
        />
      </div>,
    )

    expect(ref.current?.getLayout().layout.children?.[0]).toMatchObject({
      id: 'workspace',
    })

    const restored: IJsonModel = {
      ...initialLayout,
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: 'logs',
            children: [
              {
                type: 'tab',
                id: 'logcat-tab',
                name: 'Logcat',
                component: 'logcat',
              },
            ],
          },
        ],
      },
    }
    act(() => ref.current?.restoreLayout(restored))

    expect(ref.current?.getLayout().layout.children?.[0]).toMatchObject({
      id: 'logs',
    })
  })
})
