# Broadcast deeplink — verification note

Iteration: FIRST (no `broadcast-review.json` present when work started).
Branch: `feature/qr-studio-broadcast-deeplink`
All commands run from the worktree root `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast`.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run lint` (`tsc --noEmit`) | PASS (exit 0, no output) |
| `npx vitest run src/components/qr-studio/DeviceActionsBroadcast.test.tsx` | PASS — 5/5 new broadcast tests |
| `npx vitest run src/components/qr-studio` | PASS — 15 files, 159 tests |
| `npm test` (`vitest run`, full suite, single run) | 923 passed, **2 pre-existing failures** in `src/components/ControlPanel/ControlPanel.test.tsx` (renderer "Auto" select) |
| `npm run build` (`tsc && vite build`) | PASS — built in ~620ms |

## Pre-existing failures (not caused by this change)

`src/components/ControlPanel/ControlPanel.test.tsx` has 2 failing tests. Verified they fail on a
clean baseline: stashed all my changes (`git stash push -u` of the 4 edited + 1 new source files),
ran `npx vitest run src/components/ControlPanel/ControlPanel.test.tsx` → still 2 failed / 11 passed,
then restored with `git stash pop`. ControlPanel is untouched by this feature (changes are confined
to `src/components/qr-studio/`).

## What was changed

- `src/components/qr-studio/useDeviceActions.tsx`
  - Added `'broadcast'` to `DeviceActionKey`; added `BROADCAST_CONNECT_TEXT`.
  - Imported `listSimulators`, `simulatorAction` from `simDeckService`.
  - Added `broadcastReason(target)` and `openOnAllDevices(target, options?)` to the hook + its
    returned interface.
  - Fan-out: every Android serial from the `devices` prop via `launchDeepLink`, plus every booted
    simulator via `simulatorAction(udid, 'openUrl', { url }, customPath)`. iOS read lazily at
    broadcast time, wrapped in try/catch so SimDeck-unavailable yields zero iOS targets and never
    throws. `Promise.allSettled` so one failing device never blocks others. Aggregated summary
    `Opened on N of M devices` plus per-device failures (reusing `describeError`), surfaced through
    the existing `ResultStrip`/`onStatus`/`notify`.
  - `Pending` gained an optional `broadcast` flag; `confirmPending` branches on it so a
    confirm-required target (record/decoded) is confirmed ONCE before the fan-out. The shipped
    surfaces use `typed`/`draft` targets (never confirm), so no new dialog was added.
- `src/components/qr-studio/DeviceActionsPanel.tsx` — added an "Open on all devices" `ActionButton`
  (`outlineButtonClass`) + broadcast `ResultStrip` to the "Deep link test" card, next to the
  single-device button. Single-device behavior unchanged.
- `src/components/qr-studio/DeviceActionsAside.tsx` — mirrored the "Open on all devices" button +
  ResultStrip after the draft "Open on device" button.
- `src/components/qr-studio/DeviceActionsBroadcast.test.tsx` (new) — 5 focused tests: typed URI →
  one `launchDeepLink` per serial + one `openUrl` per booted sim (not-booted excluded);
  allSettled failure semantics; SimDeck-unavailable still broadcasts to Android; success summary in
  the strip; disabled-with-reason when zero devices.
- `src/components/qr-studio/CreatePanelDevice.test.tsx` — updated one assertion from `getByText` to
  `getAllByText(...).length > 0` because the additive broadcast button legitimately surfaces the
  same non-launchable reason as the single-device button.

No backend (`src-tauri`) changes; Rust shell-quoting untouched.
