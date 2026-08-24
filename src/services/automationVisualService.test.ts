import { describe, expect, it, vi } from 'vitest'
import { runAutomationVisualStep } from './automationVisualService'

const screenshot = (path = '/current.png') => ({
  success: true,
  path,
  filename: 'current.png',
  deviceSerial: 'pixel',
  capturedAt: '2026-08-24T00:00:00.000Z',
})

describe('runAutomationVisualStep', () => {
  it('reuses capture and records a skipped visual result when no baseline exists', async () => {
    const capture = vi.fn().mockResolvedValue(screenshot())
    const result = await runAutomationVisualStep(
      { automationId: 'smoke', deviceSerial: 'pixel' },
      { capture },
    )
    expect(capture).toHaveBeenCalledWith('pixel')
    expect(result).toEqual({
      status: 'skipped',
      screenshotPath: '/current.png',
      threshold: 16,
      reason: 'No baseline configured',
    })
  })

  it('attaches screenshot, baseline, diff, score, and reason for a failed visual assertion', async () => {
    const compare = vi.fn().mockResolvedValue({ score: 92.5, diffPath: '/diff.png' })
    const result = await runAutomationVisualStep(
      {
        automationId: 'smoke',
        deviceSerial: 'pixel',
        baselinePath: '/baseline.png',
        threshold: 12,
        passAt: 98,
      },
      { capture: vi.fn().mockResolvedValue(screenshot()), compare },
    )
    expect(compare).toHaveBeenCalledWith(expect.objectContaining({
      screenshotPath: '/current.png',
      baselinePath: '/baseline.png',
      threshold: 12,
      passAt: 98,
    }))
    expect(result).toEqual({
      status: 'failed',
      screenshotPath: '/current.png',
      baselinePath: '/baseline.png',
      diffPath: '/diff.png',
      score: 92.5,
      threshold: 12,
      reason: 'Similarity 92.50% is below 98.00%',
    })
  })

  it('keeps capture and comparison errors as visual results', async () => {
    await expect(runAutomationVisualStep(
      { automationId: 'smoke', deviceSerial: 'pixel' },
      { capture: vi.fn().mockRejectedValue(new Error('ADB unavailable')) },
    )).resolves.toMatchObject({ status: 'error', reason: 'Capture failed: ADB unavailable' })

    await expect(runAutomationVisualStep(
      { automationId: 'smoke', deviceSerial: 'pixel', baselinePath: '/baseline.png' },
      {
        capture: vi.fn().mockResolvedValue(screenshot()),
        compare: vi.fn().mockRejectedValue(new Error('bad PNG')),
      },
    )).resolves.toMatchObject({
      status: 'error',
      screenshotPath: '/current.png',
      baselinePath: '/baseline.png',
      reason: 'Comparison failed: bad PNG',
    })
  })
})
