/** Formats the webview can record, best first: MP4/H.264 (WKWebView), then WebM. */
const RECORDER_MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function pickRecorderMimeType(
  isSupported: (type: string) => boolean,
): string | null {
  return RECORDER_MIME_TYPES.find((type) => isSupported(type)) ?? null
}

export function extensionForMimeType(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** Elapsed recording time as m:ss (or h:mm:ss past an hour). */
export function formatRecordingElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}
