# Implementation Plan — Broadcast deeplink to all devices (QR Studio Device Actions)

Goal: add an "Open on all devices" (broadcast) control to QR Studio's Device Actions tab.
It sends the same deeplink/URI to EVERY connected Android device (adb) and EVERY booted iOS
Simulator (via SimDeck) at once, reusing the single-device launch path. Single-device "Open on
device" stays exactly as-is; broadcast is purely additive.

All work happens inside the worktree:
`/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast`. Use absolute paths rooted there.
Relative paths would land in the parent repo — do not use them.

## Verification commands (from package.json, run from the worktree root)
- Typecheck / lint: `npx tsc --noEmit` (package script `lint`). Baseline currently passes.
- Unit tests (single run, never watch): `npx vitest run <path>` (package script `test` is `vitest run`).
- Full build: `npx tsc && npx vite build` (package script `build`).
Use targeted `npx vitest run src/components/qr-studio/<file>` while iterating; run the full
`npx vitest run` plus `npx tsc --noEmit` before declaring done.

## Design decisions (grounded in the code I read)
- **No backend changes.** `src-tauri/src/deep_link.rs` `launch_deep_link` already single-quotes the
  URI via `sh_quote` (so `&`, `;`, `$()` are safe) and `src-tauri/src/simdeck.rs` `simulator_action`
  already forwards `params` to SimDeck's `/action` endpoint for `openUrl`. Broadcast is a pure
  frontend fan-out over the existing per-device services. Do NOT touch the Rust quoting.
- **openUrl param key is `url`.** `simulatorAction(udid, 'openUrl', { url: uri }, customPath)` — the
  Rust side forwards params verbatim and the `url` key is the SimDeck contract. `SimulatorDevice`
  (src/types/simDeck.ts) marks booted sims with the boolean field `isBooted`; filter on that.
- **No i18n for these components.** `DeviceActionsPanel.tsx`, `DeviceActionsAside.tsx` and the shared
  hook hardcode English strings (confirmed: no `useTranslation`/i18n import anywhere in
  `src/components/qr-studio/`). The `deepLink.*` keys in `src/i18n/locales/*` belong to a separate
  Deep Link Launcher feature, not QR Studio. So new broadcast strings are hardcoded English in the
  components, matching the existing pattern — the en.ts/th.ts files are NOT touched. (Noting this
  explicitly because the task brief mentioned locales; it does not apply to these files.)
- **Confirm-once semantics.** Reuse the existing `launchInfo(target)`: `typed` targets never confirm;
  `record`/`decoded` targets that set `confirm: true` must be confirmed ONCE before the fan-out, not
  per device. The broadcast button is placed on the "Deep link test" card, whose target is always
  `{ kind: 'typed', uri }` (never confirms), so the first shipped surface needs no confirm dialog —
  but `openOnAllDevices` must still honor `info.confirm` by routing through the existing pending/dialog
  flow so it is correct for any future caller. Keep it simple: reuse the existing `launchDialog`/
  `pending` machinery rather than inventing a second dialog.
- **Broadcast action state key** is a new `DeviceActionKey` value `'broadcast'`. Results are a single
  aggregated summary string surfaced through the existing `ResultStrip` (status success/error) plus
  `onStatus`/`notify`, keyed to the active device like the other actions so the existing
  "clears results when the active device changes" behavior keeps working.
- **Target enumeration.** Android serials come from the `devices` prop (same source `hasAndroidTarget`
  uses). iOS targets are read at broadcast time via `listSimulators(customPath)` filtered to
  `isBooted`, wrapped in try/catch so a SimDeck-unavailable/throwing call yields zero iOS targets and
  never blocks or fails the Android broadcast. Fan out with `Promise.allSettled` so one failing device
  never prevents the others.

---

- [ ] 1. Add `openOnAllDevices` broadcast logic to the shared hook.
      In `useDeviceActions.tsx`: (a) add `'broadcast'` to the `DeviceActionKey` union; (b) import
      `listSimulators` and `simulatorAction` from `../../services/simDeckService`; (c) add a
      `broadcastReason(target)` helper that returns a disabled reason mirroring `CONNECT_TEXT` when
      there are zero Android devices AND (since iOS is read lazily) no way to target anything — use a
      new constant e.g. `BROADCAST_CONNECT_TEXT = 'Connect a device to broadcast this link'`; reuse
      `launchInfo(target).reason` for an unlaunchable/empty URI; (d) implement
      `openOnAllDevices(target, options?)`: resolve via `launchInfo`; if `info.confirm` route through
      the existing `pending`/`confirmPending` path but mark it as a broadcast (extend `Pending` with
      an optional `broadcast: true` flag and branch `confirmPending`/`launch` on it) so confirm
      happens ONCE; otherwise run the fan-out immediately. The fan-out, wrapped in `execute('broadcast',
      serial, ...)`: build Android jobs = `devices.map(s => launchDeepLink(s, uri, packageName,
      customPath))`; build iOS jobs by `try { (await listSimulators(customPath)).filter(d =>
      d.isBooted) } catch { [] }` then `.map(sim => simulatorAction(sim.udid, 'openUrl', { url: uri },
      customPath))`; `await Promise.allSettled([...androidJobs, ...iosJobs])`; aggregate counts of
      success vs fail (an Android result is success when `result.success`; a settled rejection or a
      `success:false` is a failure — reuse `describeError` for per-device messages); return an
      `Outcome` whose message is a summary like `Opened on N of M devices` and, on any failure, lists
      the failed device labels/udids with their error. Expose `openOnAllDevices` and `broadcastReason`
      (and the `'broadcast'` state via the existing `state(key)`) in the returned `UseDeviceActions`
      interface. Handle the empty case (zero Android and zero booted sims is only known after the
      async read): keep the button enabled whenever at least one Android device is present or a sim
      read could succeed; when `devices` is empty, disable with the broadcast connect reason (matching
      how the panel already disables on `!hasDevice`).
      Files: `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast/src/components/qr-studio/useDeviceActions.tsx`
      Verify: `npx tsc --noEmit` passes (no behavior test yet — covered in step 4).

- [ ] 2. Add the "Open on all devices" button to the Deep link test card.
      In `DeviceActionsPanel.tsx`, inside the `qr-da-deeplink` card, next to the existing
      `Open link on device` `ActionButton`, add a second `ActionButton` labelled
      `Open on all devices` (English; this card's helper text stays English). Wire it to
      `device.openOnAllDevices(typedTarget, { packageName: packageName.trim() || undefined })`, pass
      `reason={device.broadcastReason(typedTarget) ?? (packageInvalid ? 'Invalid package name' :
      null)}` and `running={device.state('broadcast').status === 'running'}`. Give it a distinct
      style from the single-device button using the shared classes
      (`outlineButtonClass` from `./formControls`, imported alongside existing imports) so the two
      buttons are visually distinguishable but consistent. Add a `ResultStrip`
      `state={device.state('broadcast')}` `label="Last broadcast result"` beneath, so the per-device
      summary shows inline. Keep the existing single-device button and its ResultStrip untouched.
      Files: `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast/src/components/qr-studio/DeviceActionsPanel.tsx`
      Verify: `npx tsc --noEmit` passes; `npx vitest run src/components/qr-studio/DeviceActionsPanel.test.tsx`
      still passes (existing single-device tests must stay green).

- [ ] 3. Mirror the broadcast control on the compact aside (optional-but-expected parity).
      `DeviceActionsAside.tsx` renders an "Open on device" button for the draft target. Add an
      "Open on all devices" `ActionButton` immediately after it, wired to
      `target && device.openOnAllDevices(target)` with `reason={device.broadcastReason(target)}` and
      `running={device.state('broadcast').status === 'running'}`, plus a `ResultStrip`
      `state={device.state('broadcast')}` `label="Last broadcast result"`. Reuse `outlineButtonClass`
      for consistency with the panel. The aside's draft target is `{ kind: 'draft' }` which never
      confirms, so no dialog wiring is needed beyond the already-rendered `device.launchDialog`.
      Files: `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast/src/components/qr-studio/DeviceActionsAside.tsx`
      Verify: `npx tsc --noEmit` passes; `npx vitest run src/components/qr-studio` passes.

- [ ] 4. Add focused unit tests for the broadcast fan-out.
      Add tests to a new file following the existing mock style
      (`DeviceActionsPanel.test.tsx` mocks `deepLinkService`; `simDeckService.test.ts` mocks `invoke`).
      Prefer a dedicated test that mounts `DeviceActionsPanel` (reusing its `Harness`) with multiple
      Android serials and mocks both `../../services/deepLinkService` (`launchDeepLink`) and
      `../../services/simDeckService` (`listSimulators`, `simulatorAction`). Cover:
      (a) a `typed` URI entered in the Deep link test card → clicking "Open on all devices" calls
      `launchDeepLink` once per Android serial with the exact URI, and `simulatorAction(_, 'openUrl',
      { url }, _)` once per BOOTED simulator (seed `listSimulators` with a mix of booted/not-booted,
      assert only booted are opened); (b) `Promise.allSettled` semantics — one `launchDeepLink`
      rejecting or returning `success:false` does not stop the others, and the summary reports the
      failure count; (c) `listSimulators` rejecting (SimDeck unavailable) still broadcasts to all
      Android devices and never throws; (d) a success summary string appears in the broadcast
      ResultStrip. Keep the typed path (no confirm dialog) as the primary covered flow.
      Files: new `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast/src/components/qr-studio/DeviceActionsBroadcast.test.tsx`
      (or extend `DeviceActionsPanel.test.tsx` with a new `describe('Open on all devices')` block —
      either is acceptable; a separate file keeps the existing suite untouched).
      Verify: `npx vitest run src/components/qr-studio/DeviceActionsBroadcast.test.tsx` (or the panel
      test) passes with all new cases green.

- [ ] 5. Final full verification.
      Run the whole suite and typecheck/build to confirm nothing regressed and broadcast works
      end-to-end at the type level.
      Files: none (verification only).
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run` passes all suites; `npx vite build`
      completes without error. Clean up any temporary files created during verification.

## Notes / assumptions
- iOS targets are read lazily inside `openOnAllDevices` (not eagerly in render) so the button's
  enabled/disabled state depends only on `devices` (Android) plus the URI validity — this avoids an
  async call on every render and matches the "degrade gracefully" requirement. If zero Android
  devices are connected, the button is disabled with a clear reason even though a booted sim might
  exist; this mirrors the existing `!hasDevice` gating and keeps the UI deterministic. If the
  implementer prefers to also enable broadcast when only sims are present, that would require an
  eager (cached) sim read — out of scope here; the chosen approach is simpler and Android-first per
  the brief.
- The review loop stop contract is unchanged: the loop stops when
  `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast/.agents/tasks/broadcast-review.json`
  has `verdict` == `APPROVED`, written by the reviewer as the loop's last step.
