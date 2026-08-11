export interface AdbLiveFrameState {
  active: boolean
  width: number
  height: number
}

type Listener = (state: AdbLiveFrameState) => void

const canvases = new Map<string, Set<HTMLCanvasElement>>()
const listeners = new Map<string, Set<Listener>>()
const states = new Map<string, AdbLiveFrameState>()
// Keep the most recently painted canvas per device. A decoder can deliver its
// first cached GOP before the Macro Recorder's visible canvas mounts; without
// this backing surface the registry reports "Live" but the newly mounted
// canvas stays black until Android produces another frame.
const latestFrames = new Map<string, HTMLCanvasElement>()
const MAX_LATEST_FRAMES = 4

const idleState = (): AdbLiveFrameState => ({
  active: false,
  width: 0,
  height: 0,
})

export function getAdbLiveFrameState(serial: string): AdbLiveFrameState {
  return states.get(serial) ?? idleState()
}

function emit(serial: string, state: AdbLiveFrameState) {
  states.set(serial, state)
  listeners.get(serial)?.forEach((listener) => listener(state))
}

export function setAdbLiveFrameActive(serial: string, active: boolean) {
  if (!serial) return
  const current = getAdbLiveFrameState(serial)
  if (current.active === active) return
  emit(serial, { ...current, active })
}

/** Fan a decoded scrcpy frame out to secondary read-only canvases. */
export function publishAdbLiveFrame(
  serial: string,
  frame: CanvasImageSource,
  width: number,
  height: number,
) {
  if (!serial || width <= 0 || height <= 0) return
  const registered = canvases.get(serial)
  let latest = latestFrames.get(serial)
  if (!latest) {
    // Reuse a registered canvas when possible. If no view exists yet, create a
    // detached canvas so the frame is still copied synchronously before the
    // caller closes its VideoFrame.
    latest = registered?.values().next().value
    if (!latest && typeof document !== 'undefined') {
      latest = document.createElement('canvas')
    }
    if (latest) {
      if (latestFrames.size >= MAX_LATEST_FRAMES) {
        const oldest = latestFrames.keys().next().value
        if (oldest) latestFrames.delete(oldest)
      }
      latestFrames.set(serial, latest)
    }
  }

  if (latest && !registered?.has(latest)) {
    if (latest.width !== width || latest.height !== height) {
      latest.width = width
      latest.height = height
    }
    latest.getContext('2d')?.drawImage(frame, 0, 0, width, height)
  }

  registered?.forEach((canvas) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    canvas.getContext('2d')?.drawImage(frame, 0, 0, width, height)
  })
  const current = getAdbLiveFrameState(serial)
  if (!current.active || current.width !== width || current.height !== height) {
    emit(serial, { active: true, width, height })
  }
}

export function registerAdbLiveFrameCanvas(
  serial: string,
  canvas: HTMLCanvasElement,
): () => void {
  if (!serial) return () => undefined
  const registered = canvases.get(serial) ?? new Set<HTMLCanvasElement>()
  registered.add(canvas)
  canvases.set(serial, registered)
  const latest = latestFrames.get(serial)
  if (latest && latest !== canvas && latest.width > 0 && latest.height > 0) {
    canvas.width = latest.width
    canvas.height = latest.height
    canvas
      .getContext('2d')
      ?.drawImage(latest, 0, 0, latest.width, latest.height)
  }
  return () => {
    registered.delete(canvas)
    if (registered.size === 0) canvases.delete(serial)
  }
}

export function subscribeAdbLiveFrame(
  serial: string,
  listener: Listener,
): () => void {
  if (!serial) return () => undefined
  const registered = listeners.get(serial) ?? new Set<Listener>()
  registered.add(listener)
  listeners.set(serial, registered)
  listener(getAdbLiveFrameState(serial))
  return () => {
    registered.delete(listener)
    if (registered.size === 0) listeners.delete(serial)
  }
}
