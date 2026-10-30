import { describe, expect, it } from 'vitest'
import {
  extensionForMimeType,
  formatRecordingElapsed,
  pickRecorderMimeType,
} from './canvasRecorder'

describe('canvasRecorder', () => {
  it('prefers MP4 and falls back to WebM', () => {
    expect(pickRecorderMimeType((type) => type === 'video/mp4')).toBe('video/mp4')
    expect(pickRecorderMimeType((type) => type.startsWith('video/webm'))).toBe(
      'video/webm;codecs=vp9',
    )
    expect(pickRecorderMimeType(() => false)).toBeNull()
  })

  it('maps mime types to file extensions', () => {
    expect(extensionForMimeType('video/mp4;codecs=avc1')).toBe('mp4')
    expect(extensionForMimeType('video/webm')).toBe('webm')
  })

  it('formats elapsed time', () => {
    expect(formatRecordingElapsed(0)).toBe('0:00')
    expect(formatRecordingElapsed(65_400)).toBe('1:05')
    expect(formatRecordingElapsed(3_725_000)).toBe('1:02:05')
  })
})
