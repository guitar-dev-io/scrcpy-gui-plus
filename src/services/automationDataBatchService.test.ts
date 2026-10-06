import { describe, expect, it } from 'vitest'
import { createAutomationDataJobs, jobsForResultSubset, runAutomationDataBatch } from './automationDataBatchService'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}

describe('automation data batch', () => {
  it('retries, continues, and saves a checkpoint after each result', async () => {
    const jobs = createAutomationDataJobs([{ ID: '1' }, { ID: '2' }])
    const attempts = new Map<string, number>()
    const storage = memoryStorage()
    const checkpoint = await runAutomationDataBatch(jobs, async (job) => {
      const count = (attempts.get(job.id) ?? 0) + 1
      attempts.set(job.id, count)
      return { success: job.id === 'job-2' || count > 1, error: 'temporary' }
    }, { errorPolicy: 'retry', retryCount: 1, retryDelayMs: 0 }, { id: 'run', sourcePath: '/a.csv', flowId: 'flow', control: { paused: false, stopped: false }, storage })
    expect(checkpoint.results.map((result) => [result.status, result.attempts])).toEqual([['passed', 2], ['passed', 1]])
    expect(storage.getItem('scrcpy_automation_data_checkpoint_v1')).toContain('"status":"passed"')
  })

  it('resumes only failed or not-run jobs', () => {
    const jobs = createAutomationDataJobs([{ ID: '1' }, { ID: '2' }, { ID: '3' }])
    const checkpoint = { version: 1 as const, id: 'x', sourcePath: '/x', flowId: 'f', createdAt: '', updatedAt: '', results: jobs.map((job, index) => ({ jobId: job.id, rowId: job.rowId, record: job.record, sourceRows: job.sourceRows, attempts: 1, durationMs: 1, status: (['passed', 'failed', 'notRun'] as const)[index] })) }
    expect(jobsForResultSubset(jobs, checkpoint, 'failed').map((job) => job.id)).toEqual(['job-2'])
    expect(jobsForResultSubset(jobs, checkpoint, 'notRun').map((job) => job.id)).toEqual(['job-3'])
  })
})
