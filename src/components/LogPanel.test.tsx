import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LogPanel from './LogPanel'

describe('LogPanel package context', () => {
  it('places an App Manager shell command in the terminal draft', () => {
    render(
      <LogPanel
        dashboard
        mode="shell"
        logs={[]}
        onClear={vi.fn()}
        onRunCommand={vi.fn()}
        initialCommand="shell run-as com.android.chrome pwd"
      />,
    )

    expect(
      screen.getByPlaceholderText('Type a command or search what ADB can do...'),
    ).toHaveValue(
      'shell run-as com.android.chrome pwd',
    )
  })
})
