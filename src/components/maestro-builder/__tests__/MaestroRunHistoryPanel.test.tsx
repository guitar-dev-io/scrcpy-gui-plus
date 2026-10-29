import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runs: [] as unknown[] }))

vi.mock('../../../services/testingCatalogService', () => ({
  loadTestingCatalog: () => ({ testRuns: mocks.runs }),
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }))

import MaestroRunHistoryPanel from '../MaestroRunHistoryPanel'

const base = {
  id: 'run-1', tags: ['maestro'], targetName: 'Checkout', deviceSerial: 'pixel-1', durationMs: 5000,
  createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
}

describe('MaestroRunHistoryPanel', () => {
  it('shows why a failed run failed without expanding it', () => {
    mocks.runs = [{
      ...base, status: 'failed',
      maestro: { appId: 'com.example.app', failure: { kind: 'maestro', title: 'Maestro failure', message: 'Unable to launch app com.example.app', raw: '' } },
    }]
    render(<MaestroRunHistoryPanel refreshToken={0} />)

    expect(screen.getByText('Unable to launch app com.example.app')).toBeInTheDocument()
  })

  it('shows no reason line for a passed run', () => {
    mocks.runs = [{ ...base, status: 'passed', maestro: { appId: 'com.example.app' } }]
    render(<MaestroRunHistoryPanel refreshToken={0} />)

    expect(screen.getByText('Checkout · passed')).toBeInTheDocument()
    expect(screen.queryByText(/Unable to launch/)).not.toBeInTheDocument()
  })
})
