import {
  isPersistableMaestroArtifactPath,
  maestroArtifactsToTestRunArtifacts,
} from './maestroArtifacts'

describe('maestroArtifactsToTestRunArtifacts', () => {
  it('persists stable paths with size metadata and omits data URLs/duplicates', () => {
    const artifacts = maestroArtifactsToTestRunArtifacts(
      [
        { kind: 'screenshot', path: ' /tmp/checkpoint.png ', sizeBytes: 42 },
        { kind: 'screenshot', path: '/tmp/checkpoint.png', sizeBytes: 99 },
        { kind: 'screenshot', path: 'data:image/png;base64,abc', sizeBytes: 3 },
        { kind: 'screenshot', path: '/tmp/invalid.png', sizeBytes: -1 },
      ],
      '2026-08-09T01:00:00.000Z',
    )

    expect(artifacts).toEqual([
      {
        kind: 'screenshot',
        path: '/tmp/checkpoint.png',
        createdAt: '2026-08-09T01:00:00.000Z',
        sizeBytes: 42,
      },
      {
        kind: 'screenshot',
        path: '/tmp/invalid.png',
        createdAt: '2026-08-09T01:00:00.000Z',
      },
    ])
    expect(artifacts.some((artifact) => artifact.path.startsWith('data:'))).toBe(false)
  })

  it('accepts only non-empty non-data paths', () => {
    expect(isPersistableMaestroArtifactPath('/tmp/a.png')).toBe(true)
    expect(isPersistableMaestroArtifactPath(' DATA:image/png;base64,abc ')).toBe(false)
    expect(isPersistableMaestroArtifactPath('')).toBe(false)
  })
})
