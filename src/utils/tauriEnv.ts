/**
 * Detects whether the app is running inside the Tauri webview.
 *
 * The `@tauri-apps/api` helpers (`invoke`, `getCurrentWindow`, `listen`, ...)
 * read from `window.__TAURI_INTERNALS__`. When the frontend is opened in a
 * plain browser (e.g. hitting the Vite dev server at http://localhost:1420
 * directly instead of the Tauri window) those internals are undefined and the
 * calls throw synchronously. Guarding with this helper lets the UI render in a
 * browser without crashing, while behaving normally inside Tauri.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  )
}
