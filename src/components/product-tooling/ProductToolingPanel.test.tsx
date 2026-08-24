import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductToolingPanel } from './ProductToolingPanel'

describe('ProductToolingPanel', () => {
  it('presents recovery, activity, presets, and a reviewable diagnostic export', () => {
    const onRecoveryAction = vi.fn()
    const onExportBundle = vi.fn()
    render(<ProductToolingPanel
      devices={[{ deviceId: 'pixel', adbState: 'offline' }]}
      selectedDeviceId="pixel"
      workspaceSnapshot={{ deviceSerials: ['pixel'], selectedSerials: ['pixel'], groupAssignments: {} }}
      activity={[{ id: 'one', timestamp: '2026-01-01T00:00:00Z', kind: 'device', level: 'error', title: 'Device offline', deviceId: 'pixel' }]}
      onApplyWorkspacePreset={vi.fn()}
      onRecoveryAction={onRecoveryAction}
      onExportBundle={onExportBundle}
    />)
    expect(screen.getByText('ADB reports this device offline')).toBeInTheDocument()
    expect(screen.getByText('Device offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart ADB' }))
    expect(onRecoveryAction).toHaveBeenCalledWith('restart-adb', 'pixel')

    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/ }))
    expect(screen.getByRole('region', { name: 'Diagnostic bundle review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export reviewed bundle' }))
    expect(onExportBundle).toHaveBeenCalledWith(expect.stringContaining('Device offline'), expect.stringMatching(/diagnostics-\d+\.json/))
  })
})
