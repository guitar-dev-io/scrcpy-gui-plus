import type { MaestroArtifact } from '../../types/maestro'
import type { TestRunArtifact } from '../../types/testingCatalog'

/** Runner artifact metadata accepted by the persistence converter. */
export interface MaestroArtifactPathMetadata {
  kind?: TestRunArtifact['kind']
  path: string
  sizeBytes?: number
}

const PERSISTED_ARTIFACT_KINDS: ReadonlySet<TestRunArtifact['kind']> = new Set([
  'screenshot',
  'recording',
  'report',
  'log',
])

export function isPersistableMaestroArtifactPath(
  path: unknown,
): path is string {
  return (
    typeof path === 'string' &&
    path.trim().length > 0 &&
    !/^data:/i.test(path.trim())
  )
}

function isPersistedArtifactKind(
  kind: unknown,
): kind is TestRunArtifact['kind'] {
  return (
    typeof kind === 'string' &&
    PERSISTED_ARTIFACT_KINDS.has(kind as TestRunArtifact['kind'])
  )
}

/**
 * Converts filesystem artifact metadata into catalog artifacts. Data URLs and
 * duplicate paths are intentionally omitted; Maestro's legacy screenshots
 * array is not an input to this helper.
 */
export function maestroArtifactsToTestRunArtifacts(
  artifacts:
    | readonly (MaestroArtifact | MaestroArtifactPathMetadata)[]
    | null
    | undefined,
  createdAt: string,
): TestRunArtifact[] {
  const seenPaths = new Set<string>()
  const persisted: TestRunArtifact[] = []

  for (const artifact of artifacts ?? []) {
    if (!artifact || typeof artifact !== 'object') continue
    if (!isPersistableMaestroArtifactPath(artifact.path)) continue
    const path = artifact.path.trim()
    if (seenPaths.has(path)) continue
    if (artifact.kind !== undefined && !isPersistedArtifactKind(artifact.kind))
      continue
    seenPaths.add(path)

    const persistedArtifact: TestRunArtifact = {
      kind: artifact.kind ?? 'screenshot',
      path,
      createdAt,
    }
    if (
      typeof artifact.sizeBytes === 'number' &&
      Number.isFinite(artifact.sizeBytes) &&
      artifact.sizeBytes >= 0
    ) {
      persistedArtifact.sizeBytes = artifact.sizeBytes
    }
    persisted.push(persistedArtifact)
  }

  return persisted
}

export const convertMaestroArtifactsToTestRunArtifacts =
  maestroArtifactsToTestRunArtifacts
export const toTestRunArtifacts = maestroArtifactsToTestRunArtifacts
