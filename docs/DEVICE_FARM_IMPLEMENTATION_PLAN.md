# Mobile Device Studio - Multi-Device Implementation Plan

This plan turns the existing local Android tooling into a reliable small-team
device manager for approximately 5-30 physical devices. It intentionally
reuses the current Tauri commands, per-serial process maps, embedded scrcpy
sessions, device actions, and local storage. It does not introduce a cloud
controller, reservation service, distributed scheduler, RBAC, or another
server layer.

## Guiding constraints

- Keep `activeDevice` as the focused device for existing single-device tools.
- Add multi-selection separately; focus and selection are not the same state.
- Preserve serial-aware single-device services and fan out above them.
- Treat 30 connected devices and 30 live streams as different workloads.
- Default to four simultaneous streams and warn before exceeding nine.
- Keep local metadata in versioned `localStorage` records unless scale proves
  that a database is necessary.

## Phase 1 - Device Registry and normalized device state

Status: **Complete (foundation)**

Deliverables:

- [x] Structured ADB discovery records for `device`, `offline`, `unauthorized`,
  and unknown ADB states.
- [x] Backward-compatible `devices: string[]` discovery output for existing UI.
- [x] A frontend registry keyed by ADB serial.
- [x] Retention of previously discovered devices after disconnect.
- [x] `firstSeen`, `lastSeen`, connection type, optional IP, and cached health.
- [x] Bounded health refresh concurrency and a refresh TTL.
- [x] Unit tests for discovery merging and persistence-safe normalization.

Acceptance criteria:

- [x] Existing pages still receive the same online `devices` array.
- [x] An unauthorized/offline device is represented as structured data.
- [x] A missing device transitions to `disconnected` instead of being deleted.
- [x] Duplicate ADB rows do not create duplicate registry records.
- [x] Health refreshes cannot create an unbounded `Promise.all` burst.
- [x] TypeScript and relevant Rust tests pass.

Implemented on 2026-08-23:

- [x] `get_devices` now emits deduplicated `deviceRecords` while preserving the
  existing online-only `devices` array.
- [x] `useDeviceRegistry` retains missing devices as `disconnected`, persists the
  registry, caches health, and limits health collection to three devices at a
  time with a 60-second TTL.
- [x] `useScrcpy` feeds every discovery result into the registry and warms health
  only for newly-online devices.
- [x] Registry merge tests, TypeScript type-check, and the Rust discovery parser
  test pass.

## Phase 2 - Devices Overview and multi-select

Status: **Complete**

- [x] Switch Devices page cards to the registry.
- [x] Add All / Online / Busy / Warning / Offline filters.
- [x] Add search.
- [x] Add grid/list density controls.
- [x] Add device checkboxes, select all, and clear selection.
- [x] Keep focused `activeDevice` separate from selected device IDs.
- [x] Add a compact batch-action bar without adding a new sidebar section.
- [x] Display cached battery, storage, connection, and last-seen data.
- [x] Display temperature after the Phase 6 health command exposes it.
- [x] Add Devices page tests for filtering, search, and selection behavior.

## Phase 3 - Reusable Device Screen

Status: **Complete**

- [x] Extract the existing `DeviceGridCell` + `useEmbeddedSession` composition into
  a reusable per-serial screen component.
- [x] Preserve the current Rust `EmbedSessionState`, port ownership, WebCodecs
  decoding, touch input, screenshot, and recording paths.
- [x] Replace repeated full `DashboardLayout` tiles with the reusable screen.
- [x] Keep the focused single-device workspace and compact grid presentation
  using the same per-device screen primitive.
- [x] Add lifecycle tests for mount, device change, disconnect, and unmount.

## Phase 4 - Multi-Device Workspace

Status: **Implementation complete - 1-device physical validation passed; 4/9 pending**

- [x] Make the existing embedded grid the canonical multi-screen workspace.
- [x] Existing grid supports auto-fit and explicit 1-6 column layouts.
- [x] Existing grid supports fullscreen and individual stream start/stop.
- [x] Existing grid supports start-all and stop-all signals.
- [x] Add click-to-focus without destroying the active stream.
- [x] Add a default four-stream limit and warning before exceeding nine.
- [x] Add bounded/staggered stream startup.
- [x] Add multi-stream quality guidance and safer defaults.
- [x] Add automated policy and rendering coverage for 1, 4, and 9 streams.
- [x] Add an in-app 1/4/9 physical-validation runner with decoded-frame, live
  FPS, dimensions, timeout, cancellation, and redacted JSON evidence.
- [x] Let late grid subscribers drain the cached startup GOP before enabling
  live backpressure recovery, so reusing a Dashboard stream does not stall.
- [x] Make GUI-launched ADB discovery robust via configured SDK roots and
  conventional macOS, Linux, and Windows Android SDK locations.
- [x] Verify one simultaneous physical-device stream, including a continuous
  15-second decoded-frame/FPS run and manual Recent apps/Home input.
- [ ] Verify four simultaneous physical-device streams.
- [ ] Verify nine simultaneous physical-device streams.

Physical validation procedure: [MULTI_DEVICE_PHYSICAL_VALIDATION.md](./MULTI_DEVICE_PHYSICAL_VALIDATION.md)

## Phase 5 - Multi-device actions

Status: **Complete**

- [x] Reuse current serial-aware services and `useDeviceWorkspace` behavior.
- [x] Existing fan-out covers navigation, rotation, screenshots, recordings,
  APK installation, app restart, text, tap, swipe, and supported macros.
- [x] Add a bounded local batch runner instead of unbounded `Promise.all`.
- [x] Return per-device success/failure results and a batch summary.
- [x] Expose power and volume actions in the selected-device toolbar.
- [x] Add first-class reboot fan-out.
- [x] Add push/pull file fan-out with explicit destinations.
- [x] Add shell-command fan-out with per-device output.
- [x] Add confirmation handling for destructive app/data actions.
- [x] Add batch runner and partial-failure tests.

## Phase 6 - Configurable groups and health UX

Status: **Complete**

- [x] Existing fixed group assignments persist in localStorage.
- [x] Existing health includes battery level, storage, connection/IP, resolution,
  Android version, memory, uptime, and charging state.
- [x] Replace the fixed group enum with local `{ id, name, deviceIds }` records.
- [x] Add create, rename, delete, and assign group operations.
- [x] Add battery temperature to the health snapshot.
- [x] Add Android screen state to the health snapshot.
- [x] Derive Online / Busy / Warning / Offline without monitoring history.
- [x] Stagger background health refresh across the registry.
- [x] Pause expensive polling when relevant views are hidden.
- [x] Add health parsing and group migration tests.

## Phase 7 - Automation integration

Status: **Complete**

- [x] Keep the existing single-device macro, Maestro, and test-session runners.
- [x] Maestro backend already accepts an explicit device serial and run ID.
- [x] Existing Device Workspace can replay supported macros across selected
  devices.
- [x] Add Current Device / Selected Devices / Device Group targeting.
- [x] Add a shared automation target selector component.
- [x] Fan out locally with bounded concurrency.
- [x] Support cancellation without losing completed device results.
- [x] Aggregate pass/fail, duration, logs, screenshots, recordings, and reports by
  device serial.
- [x] Persist one parent run with child results per device.
- [x] Add mixed pass/fail and cancellation tests.

Implemented on 2026-08-23:

- [x] The Automation page can run a selected Maestro YAML flow against the
  current device, the Devices-page selection, or a configurable device group.
- [x] Batch Maestro execution uses two local workers and explicit per-child run
  IDs; cancelling stops active Maestro processes and leaves completed results
  intact.
- [x] Versioned local history stores one immutable parent summary and ordered
  child results with timings, logs, errors, and artifact paths per serial.
- [x] Target resolution, selector interaction, mixed-result orchestration,
  cancellation, persistence, and Automation-page fan-out tests pass.

## Progress summary

- [x] Phase 1 - Device Registry and normalized device state
- [x] Phase 2 - Devices Overview and multi-select
- [x] Phase 3 - Reusable Device Screen
- [ ] Phase 4 - Multi-Device Workspace (1-device passed; physical 4/9 pending)
- [x] Phase 5 - Multi-device actions
- [x] Phase 6 - Configurable groups and health UX
- [x] Phase 7 - Automation integration

## Explicitly out of scope

- Cloud device farm or browser remote streaming
- Kubernetes or distributed workers
- Reservations, organizations, tenants, billing, or enterprise RBAC
- Multi-region control plane
- iOS expansion as part of this Android registry work
- AI agents or a complex queue scheduler
