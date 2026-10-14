# Broadcast deeplink to all connected devices in QR Studio

QR Studio's Device Actions gain an "Open on all devices" control that fans the same deeplink/URI out to every connected Android device (via the existing adb `launchDeepLink`) and every booted iOS Simulator (via SimDeck `simulatorAction(_, 'openUrl', …)`) in one click. The change is a pure frontend fan-out layered on top of the existing single-device launch path — no backend, no new validation, no change to the single-device button. The feature commit (`c0e876d`) is cleanly scoped to five QR Studio files plus the two task notes; the large merge-base diff is just the intervening `menu-consolidation` branch this feature sits on, not part of this work.

Watch for: nothing blocking. One intentional, documented product tradeoff — the broadcast button gates on Android presence (`devices.length === 0`), so a workspace with only booted iOS simulators and no Android device shows the button disabled even though a sim could receive the link (**confirmed**). The plan calls this out as a deliberate Android-first simplification; flagged here as informational.

**Verdict**: APPROVED

## High-level view

The fan-out reuses the existing `launchInfo(target)` resolution for URI validation and confirm semantics, so broadcast and single-device share one source of truth for what counts as a launchable URI — no duplicated or weakened validation. Android targets come from the same `devices` prop `hasAndroidTarget` already uses; iOS targets are read lazily at click time.

iOS enumeration is defensive: `listSimulators` is wrapped in try/catch that collapses to zero targets on any failure, only `isBooted` simulators are opened, and the `simulatorAction(udid, 'openUrl', { url }, customPath)` call shape matches the service signature exactly. A SimDeck outage never throws and never blocks the Android broadcast.

Failure isolation is handled with `Promise.allSettled` over all jobs, so one offline device or a rejected simulator call does not abort the rest. The result is a single aggregated `Opened on N of M devices` summary (with per-device failure labels appended on error) surfaced through the existing `ResultStrip`/`onStatus`/`notify` plumbing.

The backend is untouched — Rust shell-quoting in `deep_link.rs` is not in the diff. QR Studio components hardcode English and do not use i18n, so the task brief's locale expectation does not apply here; the implementation correctly leaves `en.ts`/`th.ts` alone, matching the existing pattern. The single-device path is unmodified; broadcast is additive. Verification evidence (lint, targeted + full vitest, build) is recorded and the two full-suite failures are shown to be pre-existing in `ControlPanel`, unrelated to this change.

<details>
<summary>Issues (1)</summary>

1. **iOS-only workspace gating** — the broadcast button disables on `devices.length === 0`, so a machine with only booted simulators (no Android) cannot broadcast despite a reachable target. Documented as a deliberate Android-first tradeoff in the plan; non-blocking. Revisit only if iOS-only broadcast becomes a requirement.

</details>

<details>
<summary>Details</summary>

### Shared resolution through `launchInfo`

Both `openOnAllDevices` and the inner `broadcast` callback resolve the URI through the existing `launchInfo(target)` and act on `info.uri`/`info.confirm` — the same function the single-device `openOnDevice` uses. There is no second URI parser, no re-implemented `validateUri`, and no relaxed check. A `typed` target (the Deep link test card and the aside's draft) never confirms, so the shipped surfaces run the fan-out directly; `confirmPending` was extended with a `broadcast` flag so that a confirm-required target (record/decoded) is confirmed once before fan-out rather than per device. This keeps the confirm-once contract correct for any future caller even though no shipped surface exercises it yet.

### iOS enumeration and graceful degradation

```
let booted = []
try {
  const sims = await listSimulators(customPath)
  booted = sims.filter(sim => sim.isBooted).map(...)
} catch {
  booted = []
}
```

The read happens lazily inside the fan-out, filtered to `isBooted`, and any throw collapses to zero iOS targets. The simulator call is `simulatorAction(sim.udid, 'openUrl', { url: uri }, customPath)` — udid, action id, `{ url }` params, customPath — which matches the service signature `(udid, action, params?, customPath?)` exactly. `'openUrl'` type-checks as a `SimulatorActionId` (the passing `tsc --noEmit` confirms). The "SimDeck unavailable still broadcasts to Android" test exercises the rejection branch and asserts Android still receives all two sends with no simulator call.

### Failure isolation via allSettled

All Android and iOS jobs are collected and run under `Promise.allSettled`, so a rejected promise or a `success:false` result is recorded as a failure without aborting siblings. A settled rejection is described via `friendlyMessage`; a `success:false` reuses the existing `describeError` (so `no_handler`/"Activity not started" still map to the friendly `NO_HANDLER` string). The aggregate is `Opened on N of M devices`, and on any failure the per-device labels (`deviceLabels[serial]` or the sim name) are appended. The allSettled test drives one serial to `success:false` and asserts the summary reports `1 of 2` plus the failing device label, confirming no fail-fast.

### Empty-devices gate

`broadcastReason` returns `BROADCAST_CONNECT_TEXT` when `devices.length === 0`, and `openOnAllDevices` early-returns in the same case, so the button is disabled with a clear reason and clicking is a no-op. The inner fan-out also guards `jobs.length === 0` with "No connected devices to broadcast to" as a defensive backstop. The disabled-with-reason case is covered by a test that asserts the button is disabled, the reason text is present, and neither service is called. The gate keys on Android presence only — an iOS-only workspace is disabled despite a reachable booted sim; this is the one documented tradeoff noted above.

### Single-device path untouched

The broadcast button and its `ResultStrip` are added alongside the single-device controls in both `DeviceActionsPanel` (Deep link test card) and `DeviceActionsAside` (draft); the existing single-device buttons, their reasons, and their result strips are not modified. The panel forwards the trimmed package name; the aside passes none, matching its draft flow.

### Tests and evidence

Five focused tests in the new `DeviceActionsBroadcast.test.tsx` cover: per-serial `launchDeepLink` + booted-only `simulatorAction`, allSettled failure semantics, SimDeck-unavailable degradation, success summary in the strip, and disabled-with-reason on zero devices. The `CreatePanelDevice` suite was updated minimally — a `getByText` → `getAllByText(...).length > 0` relaxation and a `toHaveLength(3)` on the connect reason — both legitimate consequences of the additive broadcast button surfacing the same reason as the single-device button, not weakened assertions.

The verify note records lint (`tsc --noEmit`) PASS, the new file 5/5, the qr-studio directory 159 tests, the full suite 923 passed with 2 pre-existing `ControlPanel` failures (shown to fail on a clean stash baseline, and `ControlPanel` is outside this feature's touched files), and `build` PASS. Evidence is present and sufficient; no suite was re-run during review.

### Backend and i18n

The feature commit touches zero `src-tauri` files, so `deep_link.rs` shell-quoting (single-quoted URI, safe `&`) is unchanged. QR Studio components contain no `useTranslation`/i18n usage — strings are hardcoded English throughout (CONNECT_TEXT, "Open on device", etc.), so adding the new strings as hardcoded English matches the existing pattern and the `deepLink.*` locale keys belong to a separate feature. Leaving `en.ts`/`th.ts` untouched is correct here; the task brief's locale check does not apply to these components.

</details>

<details>
<summary>File map</summary>

- `src/components/qr-studio/useDeviceActions.tsx` — new `broadcast`/`openOnAllDevices`/`broadcastReason`, `'broadcast'` action key, `Pending.broadcast` flag, confirm-once branch. (Rest of the diff is Prettier reflow.)
- `src/components/qr-studio/DeviceActionsPanel.tsx` — "Open on all devices" button + ResultStrip on the Deep link test card.
- `src/components/qr-studio/DeviceActionsAside.tsx` — mirrored broadcast button + ResultStrip after the draft "Open on device".
- `src/components/qr-studio/DeviceActionsBroadcast.test.tsx` — new, 5 broadcast tests.
- `src/components/qr-studio/CreatePanelDevice.test.tsx` — assertion relaxations for the additive button.
- `.agents/tasks/broadcast-plan.md`, `.agents/tasks/broadcast-verify-note.md` — task notes.

Full feature diff: `git diff c0e876d~1..c0e876d` in the worktree.

</details>
