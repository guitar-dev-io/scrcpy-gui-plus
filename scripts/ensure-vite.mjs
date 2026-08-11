import { spawnSync } from 'node:child_process'
import { createServer } from 'vite'

const DEV_PORT = 1420
const DEV_URL = `http://localhost:${DEV_PORT}`
const PROJECT_MARKERS = ['<title>Mobile Device Studio</title>', '/src/main.tsx']

async function probeDevServer() {
  try {
    const response = await fetch(DEV_URL, {
      signal: AbortSignal.timeout(1_500),
      headers: { accept: 'text/html' },
    })
    const body = await response.text()
    if (
      response.ok &&
      PROJECT_MARKERS.every((marker) => body.includes(marker))
    ) {
      return 'ready'
    }
    return 'occupied'
  } catch {
    return 'free'
  }
}

function reportSimDeckDevices() {
  const result = spawnSync('simdeck', ['list'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 15_000,
  })

  if (result.error || result.status !== 0) {
    const reason =
      result.error?.message || result.stderr?.trim() || 'SimDeck is unavailable'
    console.warn(`[dev] Device check skipped: ${reason}`)
    return
  }

  try {
    const payload = JSON.parse(result.stdout)
    const devices = Array.isArray(payload.simulators) ? payload.simulators : []
    const available = devices.filter((device) => device.isAvailable !== false)
    const booted = available.filter((device) => device.isBooted)
    const active = booted.map((device) => device.name).join(', ')
    console.log(
      `[dev] SimDeck devices: ${available.length} available, ${booted.length} booted${active ? ` (${active})` : ''}`,
    )
  } catch (error) {
    console.warn(
      `[dev] Could not parse SimDeck device list: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function startVite() {
  const server = await createServer({
    server: { port: DEV_PORT, strictPort: true },
  })
  try {
    await server.listen()
  } catch (error) {
    await server.close()
    // Another startup may have won the race. Reuse it only when it is this app.
    if ((await probeDevServer()) === 'ready') {
      console.log(`[dev] Reusing Mobile Device Studio dev server at ${DEV_URL}`)
      reportSimDeckDevices()
      return
    }
    throw error
  }

  console.log(`[dev] Started Mobile Device Studio dev server at ${DEV_URL}`)
  server.printUrls()
  reportSimDeckDevices()

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const state = await probeDevServer()
if (state === 'ready') {
  console.log(`[dev] Reusing Mobile Device Studio dev server at ${DEV_URL}`)
  reportSimDeckDevices()
} else if (state === 'occupied') {
  console.error(
    `[dev] Port ${DEV_PORT} is used by another service. Stop it before running Tauri.`,
  )
  process.exitCode = 1
} else {
  await startVite()
}
