# Mobile Device Studio - Stability, Sync, and Visual Compare Plan

This plan covers the next development sequence after the existing device-farm
foundation. It records the current architecture before any broad refactor and
keeps the product local-first: physical Android devices, USB/Wireless ADB, and
only a bounded subset of active streams.

## Phase 0 - Architecture audit

Status: **Complete**

### Existing architecture to reuse

- [x] Device identity and registry are serial-keyed through `RegisteredDevice`
  and `DeviceRegistryMap`, persisted in `scrcpy_device_registry_v1`.
- [x] Structured discovery preserves `device`, `offline`, `unauthorized`,
  `disconnected`, and unknown ADB states.
- [x] ADB execution is centralized in the Rust `adb` module and uses validated
  argument arrays rather than shell command concatenation.
- [x] USB/Wireless discovery shares `get_devices`; Wireless ADB pairing,
  connect, mDNS, and LAN scan commands already exist.
- [x] External scrcpy processes are keyed by device serial in `ScrcpyState`.
- [x] Embedded screen/control sessions are isolated in `EmbedSessionState`,
  with one owned backend session per serial and fan-out subscribers.
- [x] Embedded startup has per-serial locks, preventing duplicate concurrent
  scrcpy-server starts.
- [x] Screen input uses the embedded session control socket; touch mapping and
  letterbox handling are centralized in `useDeviceInput` and
  `deviceCoordinates`.
- [x] Recordings and logcat processes are stored in serial-keyed Rust maps.
- [x] Screenshots share the existing screenshot service, history, paths, and
  embedded-session capture command.
- [x] Multi-device actions use bounded, ordered, per-device result execution
  through `runDeviceBatch` and existing device action services.
- [x] Device groups and automation targets/runs use bounded local persistence
  and support current, selected, and group scopes.
- [x] Device health is merged into the registry and refreshed with TTL,
  staggering, visibility gating, and bounded concurrency.
- [x] Session, screenshot, recording, group, automation, launch-profile, and
  layout persistence already use local storage; no database is required.
- [x] Embedded session teardown detects end-of-stream, removes stale sessions,
  kills the owned child, removes its ADB forward, and emits status events.

### Single-device assumptions and gaps at audit time

- [x] `activeDevice` is intentionally the focused device, while open device
  workspaces and backend processes remain serial-keyed.
- [ ] The normalized connection state lacks explicit `connecting`,
  `reconnecting`, and `error` states shared by all surfaces.
- [ ] Device discovery uses a 3-second UI polling loop; native
  `adb track-devices` is not yet used.
- [ ] Embedded screen failure is detected and cleaned up, but the frontend does
  not perform bounded automatic recovery.
- [ ] Recovery intent does not yet distinguish user stop, unexpected crash,
  device loss, and application shutdown end-to-end.
- [ ] `useConnectionHealth` consumes an unscoped global scrcpy log stream, so
  simultaneous external sessions can mix metrics.
- [ ] Main-window shutdown cleans embedded sessions, companion, and auto
  capture, but does not yet centrally drain external scrcpy, recording,
  logcat, embedded-mirror, iOS, and Maestro process registries.
- [ ] Open Android tabs, multi-device selection, active group, and logical
  workspace state are not restored as one safe workspace snapshot.
- [ ] No unified recovery status/error model is exposed to cards, detail,
  health, and multi-device screens.

## Phase 1 - Stability and auto recovery

Status: **Implementation complete; available-hardware QA pending**

- [x] Add one normalized connection/recovery state contract.
- [x] Add configurable bounded recovery policy (500 ms, 1 s, 2 s).
- [x] Isolate recovery state and retries per device.
- [x] Add native event-driven device tracking with lightweight fallback.
- [x] Recover unexpected embedded screen termination without restarting a
  session that the user intentionally stopped.
- [x] Resume recovery when the same serial returns after USB/Wireless loss.
- [x] Expose friendly reconnecting/offline/unauthorized/error UI and actions.
- [x] Centralize owned-process shutdown across external scrcpy, embedded
  screen/mirror, recording, logcat, iOS, Maestro, companion, and auto-capture
  registries when the main window closes.
- [x] Persist and safely restore logical workspace state only (open Android
  tabs, focused device, multi-device view, and registered-device selection;
  never processes or live streams).
- [x] Add recovery, retry-limit, expected-stop, isolation, and cleanup tests.
- [ ] Perform available-hardware USB/reconnect and screen-crash QA.

## Phase 2 - Basic broadcast and sync groups

Status: **Implementation complete; available-hardware QA pending**

- [x] Master and target selection inside Multi Device Workspace.
- [x] Start/stop sync and per-target pause/resume/remove.
- [x] Broadcast Home, Back, Recent, Power, Volume, Rotate, app actions, and text.
- [x] Preserve ordered per-device success/failure and latency results.
- [x] Keep existing Quick Actions unchanged.

## Phase 3 - Relative tap, swipe, and long press

Status: **Implementation complete; available-hardware QA pending**

- [x] Normalize master coordinates to ratios.
- [x] Transform taps and swipe endpoints using fresh per-target
  resolution/orientation geometry.
- [x] Add supported long-press broadcasting through a stationary bounded swipe.
- [x] Add mapping, orientation, edge, partial-failure, and timeout tests.

## Phase 4 - Smart element broadcast

Status: **Implementation complete; available-hardware QA pending**

- [x] Match resource-id, content-desc, then appropriate text.
- [x] Fall back to relative coordinates independently for each target.
- [x] Provide Smart, Relative, and Raw modes; default to Smart.
- [x] Add selector-priority, Smart/Relative fallback, Raw, ordered-result,
  and timeout coverage.

## Phase 5 - Capture All and compare sessions

Status: **Implementation complete; available-hardware QA pending**

- [x] Capture selected online devices sequentially with device metadata and
  existing screenshot storage/history rules.
- [x] Persist bounded lightweight compare sessions and reference selection.
- [x] Add a Compare workspace/tab without a new top-level navigation section.
- [x] Allow compare-session creation from Capture All or selected history
  entries, with malformed-storage and missing-history handling.

## Phase 6 - Visual compare workspace

Status: **Implementation complete; available-hardware QA pending**

- [x] Side-by-side, fit, zoom, pan, fullscreen, reference change, and recapture.
- [x] Shared synchronized zoom, optional synchronized pan, and links back to
  Device Detail/Logcat.
- [x] Preserve reference intent when replacing a recaptured screenshot.

## Phase 7 - Overlay and deterministic difference

Status: **Implementation complete; available-hardware QA pending**

- [x] Overlay with opacity and selectable comparison target.
- [x] Aspect-ratio-safe contain normalization and configurable pixel threshold.
- [x] Difference mask, deterministic similarity score, and configurable labels.
- [x] Unit coverage for normalization, validity masking, thresholds, scores,
  labels, and compare view-mode controls.

## Phase 8 - Ignore regions and baselines

Status: **Pending**

- [ ] Ignore status/navigation bars.
- [ ] Normalized custom ignore regions.
- [ ] Save local baselines and compare current captures against them.

## Phase 9 - Automation visual integration

Status: **Partial: multi-device/group targeting already complete**

- [x] Current, selected-device, and group automation targets.
- [x] Per-device functional run results and bounded local history.
- [ ] Reused capture step in the automation flow.
- [ ] Baseline comparison step with independent functional/visual status.
- [ ] Attach screenshot, baseline, diff, score, and reason to existing results.

## Phase 10 - Product tooling

Status: **Partial**

- [x] Device Detail already exposes core ADB/device/health information.
- [x] Basic diagnostic report and bug-report infrastructure already exist.
- [x] Launch/quality profiles and local dashboard layouts already exist.
- [ ] Contextual recovery diagnostics/actions.
- [ ] Named multi-device workspace presets.
- [ ] Lightweight Cmd/Ctrl+K command palette reusing existing operations.
- [ ] Bounded device/activity timeline.
- [ ] Reviewable diagnostic bundle covering recent lifecycle and device state.

## Performance and validation constraints

- Never auto-start a stream merely because a device is connected.
- Keep expensive frame data outside general React state.
- Continue bounded/staggered health and batch work.
- Serialize conflicting work per device while allowing different devices to
  operate concurrently.
- Validate against the available two physical devices. Higher connection-count
  checks use deterministic automated/load tests and are documented as such;
  they do not claim unavailable 4/9/20/30-device physical evidence.

## Progress summary

- [x] Phase 0 - Architecture audit
- [x] Phase 1 - Stability and auto recovery (available-hardware QA pending)
- [x] Phase 2 - Basic broadcast and sync groups (available-hardware QA pending)
- [x] Phase 3 - Relative tap/swipe/long press (available-hardware QA pending)
- [x] Phase 4 - Smart element broadcast (available-hardware QA pending)
- [x] Phase 5 - Capture All and compare sessions (available-hardware QA pending)
- [x] Phase 6 - Visual compare workspace (available-hardware QA pending)
- [x] Phase 7 - Overlay and deterministic difference (available-hardware QA pending)
- [ ] Phase 8 - Ignore regions and baselines
- [ ] Phase 9 - Automation visual integration
- [ ] Phase 10 - Product tooling
