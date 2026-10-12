// Friendly handling for Rust-backed calls when the app runs in a plain browser.
export const DESKTOP_ONLY_MESSAGE = 'Requires the desktop app'

export class DesktopRequiredError extends Error {
    constructor() {
        super(DESKTOP_ONLY_MESSAGE)
        this.name = 'DesktopRequiredError'
    }
}

function looksLikeMissingRuntime(reason: unknown): boolean {
    if (!(reason instanceof TypeError)) return false
    return /invoke|__TAURI/i.test(reason.message)
}

/** Maps the raw TypeError thrown by a missing Tauri runtime to a DesktopRequiredError. */
export function friendlyError(reason: unknown): unknown {
    return looksLikeMissingRuntime(reason) ? new DesktopRequiredError() : reason
}

/** Message safe to show in the UI: raw runtime TypeErrors become the desktop-only text. */
export function friendlyMessage(reason: unknown, fallback: string): string {
    const mapped = friendlyError(reason)
    return mapped instanceof Error ? mapped.message : fallback
}

export function isDesktopRequired(reason: unknown): boolean {
    return friendlyError(reason) instanceof DesktopRequiredError
}

/** Runs a Rust-backed call, rethrowing a missing runtime as DesktopRequiredError. */
export async function withDesktop<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call()
    } catch (reason) {
        throw friendlyError(reason)
    }
}
