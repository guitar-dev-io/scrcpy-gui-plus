# Project Audit — Phase 1

## Status

Phase 1 is an architecture audit only. It does not authorize changes to application behavior, frontend state contracts, Tauri IPC, ADB, scrcpy, device management, or backend commands.

The current redesign inputs are incomplete:

- `UI_REDESIGN_PROMPT.md` contains placeholder instructions rather than a full redesign prompt.
- `DESIGN_SYSTEM.md` lists token categories but provides no token values.
- `PAGE_SPECIFICATIONS.md` lists page names but provides no layouts, states, or acceptance criteria.
- Every file under `images/` is ASCII placeholder text rather than image data.

Pixel-accurate design work must not begin until the real documents and images replace these placeholders.

## System Overview

| Layer | Technology | Current responsibility | Migration rule |
| --- | --- | --- | --- |
| Desktop shell | Tauri 2 | Windows, splash screen, capabilities, command registration | Preserve configuration and command names |
| Frontend | React 19 + TypeScript 6 | UI composition and feature orchestration | Presentation-only migration |
| Styling | Tailwind CSS 4 + CSS variables | Themes, light/dark modes, component utility classes | Introduce tokens incrementally |
| IPC | Tauri `invoke` and event listeners | Frontend/backend communication | Preserve names, payloads, results, and events |
| Device runtime | Rust + ADB + scrcpy | Discovery, pairing, control, streaming, recording, files | Treat as protected business logic |
| Persistence | `localStorage` | Preferences, history, layouts, macros, keymaps, screenshots | Preserve keys and stored shapes |

## Frontend Entry and Composition

- `src/main.tsx` mounts `App` inside `React.StrictMode` and `I18nProvider`.
- `src/App.tsx` remains the application orchestrator. It owns global alerts, modal visibility, file dialogs, app initialization, drag-and-drop, and wiring between shared hooks and UI components.
- `src/components/app-shell/AppShell.tsx` is the current visual frame for the error boundary, background, header, scrolling content, footer, and overlays.
- `src/components/dashboard/DashboardLayout.tsx` is the current dashboard presentation layout.
- Feature tools remain modal overlays controlled by `App.tsx`.

The current worktree already contains uncommitted App Shell and Dashboard presentation work from earlier approved phases. Phase 1 records that state but does not expand it.

## Routing and Navigation

There is no router dependency and no route registry. The application renders one dashboard composition and opens feature tools through local boolean state.

Consequences for later phases:

- The eight page names in `PAGE_SPECIFICATIONS.md` are not current routes.
- Introducing routes is an architecture change and must be approved as part of App Shell work.
- Existing modal entry points must remain functional until an approved page replacement reaches behavioral parity.
- Tauri-safe reload and deep-link behavior must be defined before choosing browser, hash, memory, or state-based routing.

## State Management

### Shared application state

`src/hooks/useScrcpy.ts` is the de facto application store. It owns:

- discovered devices and active-device selection;
- scrcpy configuration and binary status;
- running-device/session state;
- logs and download progress;
- automatic USB polling and wireless connection history;
- theme and color-mode preferences;
- core device, scrcpy, pairing, file-push, and APK-install actions.

It must not be rewritten during presentation phases.

### Feature state

Feature hooks own focused state for screenshots, live preview, device actions, wireless pairing, file management, logcat, macros, UI inspection, embedded sessions, workspaces, keymaps, iOS mirroring, and related tools.

### Context

`I18nProvider` is the only general application context. There is no Redux, Zustand, or equivalent global state library.

### Persistence

Persistence is distributed across `localStorage`. Existing keys cover scrcpy configuration, auto-connect, theme, color mode, locale, wireless history, onboarding, screenshots, preview FPS, macros, keymaps, device groups, workspace layouts, presets, deep links, and custom commands.

Later phases must preserve all keys and serialized shapes unless a separately approved migration is supplied.

## Device Discovery and Connection Flow

1. Restore saved configuration, theme, color mode, locale, and history.
2. Resolve the custom/local/system scrcpy and ADB paths.
3. Check scrcpy availability and version.
4. Invoke `get_devices` for the initial ADB device list.
5. Poll `get_devices` every three seconds while auto-connect is enabled.
6. Select the first available device when no valid active device exists.
7. Copy the selected device into the scrcpy launch configuration.
8. Support USB authorization and wireless connection through direct address, pairing code, QR pairing, mDNS discovery, and recent history.
9. Start a session through `run_scrcpy`.
10. Update logs and running-device state from `scrcpy-log` and `scrcpy-status` events.
11. Stop a selected session through `stop_scrcpy`.

UI migration must reuse this flow without duplicating or replacing it.

## ADB and scrcpy Boundaries

### ADB

`src-tauri/src/adb.rs` centralizes safe ADB execution for newer backend features. It provides:

- serial and package validation;
- argument-array execution rather than shell interpolation;
- command timeouts;
- structured error classification;
- text and binary output paths.

Some core legacy commands still use shared process helpers directly. Presentation work must not change either path.

### scrcpy

`src-tauri/src/commands.rs` owns:

- binary discovery and version checks;
- device discovery and wireless connection commands;
- `ScrcpyConfig` deserialization;
- CLI argument construction;
- process creation, tracking, and termination;
- audio and video codec fallback behavior;
- recovery from unsupported future command-line options;
- scrcpy downloads and update checks.

### Embedded sessions

`embed_mirror.rs` and `embed_session.rs` implement separate embedded streaming paths. The full embedded session pushes `scrcpy-server`, configures ADB forwarding, and manages video and control sockets. These paths are not interchangeable with the external scrcpy process flow.

## Backend State

Tauri-managed state includes:

- `ScrcpyState` for device-to-process tracking;
- `RecordingState` for active recordings;
- `BugReportState`;
- `LogcatState`;
- `IosState`;
- `EmbedMirrorState`;
- `EmbedSessionState`.

Window-close cleanup terminates embedded sessions and removes related resources. Later UI phases must preserve this lifecycle.

## IPC Contract Boundary

The command registry in `src-tauri/src/lib.rs` is the source of truth. It covers:

- scrcpy and ADB lifecycle;
- pairing, QR pairing, and mDNS discovery;
- screenshots, previews, files, and recordings;
- device actions and status;
- package management;
- logcat and bug reports;
- deep links, macros, custom commands, test sessions, and UI inspection;
- iOS mirroring;
- embedded mirror/session input and capture;
- system paths, clipboard, reports, splash screen, and version data.

Protected IPC invariants:

- Do not rename commands.
- Do not change request property names.
- Do not change response shapes or error codes.
- Do not rename or reinterpret emitted events.
- Do not replace typed service wrappers with presentation logic.
- Do not move device or process lifecycle decisions into components.

## Reusable Frontend Assets

### Layout and feedback

- `AppShell`
- `DashboardLayout`
- `ErrorBoundary`
- `ThemedModal`
- `Tooltip`
- `Header`, `Footer`, and `LogPanel`

### Device and session UI

- `Sidebar`
- `DeviceControlToolbar`
- `ControlPanel`
- `SessionBehavior`
- `LivePreview`
- device preview cards and `PreviewCardShell`
- embedded device display, grid, rails, status, and session components

### Feature UI

Existing components and hooks cover screenshots, files, apps, logcat, bug reports, pairing, macros, presets, keymaps, deep links, device status, connection health, UI inspection, test sessions, and iOS mirroring.

Later pages should compose these live features instead of rebuilding their business logic.

## Current Design System

The current visual system uses:

- semantic CSS variables for primary color, text, surfaces, borders, glass, and scrollbars;
- five accent themes: ultraviolet, astro, carbon, emerald, and bloodmoon;
- light, dark, and system modes;
- a warm stone palette for light-mode overrides;
- Tailwind utility classes for nearly all component-level styling;
- recurring glass surfaces, compact uppercase labels, large radii, and elevated shadows;
- Lucide icons and localized strings.

Missing foundations:

- specified typography scale;
- spacing scale and layout grid;
- radius and elevation roles;
- motion tokens;
- component variants and states;
- accessibility acceptance criteria;
- actual reference images and measurable visual targets.

## Duplication and Migration Risks

- Modal shells are repeated across many feature components.
- Wireless pairing and recent-device controls exist in both `Sidebar` and `WirelessPairingWizard`.
- Device controls are represented by several toolbar/rail/bottom-bar variants.
- External and embedded workspaces overlap in device, status, and session concepts.
- Panel, button, input, badge, section-header, and empty-state styles are repeated as long class strings.
- IPC usage is split between typed service modules and direct calls in older hooks/components.
- `App.tsx` remains a large orchestration boundary and should not be decomposed by moving business logic into presentation components.

Cleanup must happen only after behavioral parity, not during page construction.

## Requested Page Mapping

| Requested page | Existing live sources |
| --- | --- |
| Dashboard | active device, live preview, toolbar, control panel, session settings, logs |
| Devices | device list, device status/actions, device workspace, app manager |
| Sessions | running-device state, scrcpy lifecycle, external and embedded workspaces |
| Screenshots | `useScreenshot`, screenshot service, screenshot manager |
| Recordings | scrcpy recording configuration and device recording commands |
| File Explorer | `FileManager`, `useFileManager`, file-manager service |
| Wireless ADB | `useScrcpy` pairing/connect methods, `useWirelessPairing`, QR and mDNS UI |
| Settings | scrcpy configuration, binary path, themes, color mode, locale, persisted preferences |

No mock data is required for any page. Empty, loading, error, offline, and running states must come from existing hooks and services.

## Protected Invariants for All Later Phases

1. Preserve all Tauri command names and payloads.
2. Preserve ADB validation, execution, timeout, and error behavior.
3. Preserve scrcpy argument construction, process tracking, and fallback behavior.
4. Preserve device polling, selection, pairing, and session state.
5. Preserve event names and listener cleanup.
6. Preserve `localStorage` keys and data shapes.
7. Preserve feature hooks and service contracts.
8. Preserve localization and keyboard shortcuts.
9. Use real state; do not add mock device or session data.
10. Keep each migration phase reversible and limited to its approved scope.

## Implementation Plan

### Phase 1 — Audit Project

Create and approve this audit as the contract boundary for later work.

### Phase 2 — Design System

After the real design sources are available, define semantic tokens and reusable UI primitives. Do not migrate pages yet.

### Phase 3 — App Shell

Finalize the application frame, navigation model, route strategy, responsive behavior, and overlay ownership. Preserve feature entry points.

### Phase 4 — Dashboard

Implement the approved dashboard reference using existing device, preview, toolbar, inspector, and log state. Validate real empty/offline/running states.

### Phase 5 — Other Pages

Migrate Devices, Sessions, Screenshots, Recordings, File Explorer, Wireless ADB, and Settings incrementally. Complete and verify one page before starting the next.

### Phase 6 — Cleanup

Consolidate duplicated primitives and presentation flows, remove superseded UI after parity, and complete accessibility, localization, regression, and cross-platform verification.

## Phase 1 Completion Criteria

- Architecture and runtime boundaries are documented.
- Routing, state, persistence, IPC, ADB, and scrcpy ownership are identified.
- Existing reusable UI and duplication risks are recorded.
- Requested pages are mapped to real data sources.
- Protected invariants and later phase gates are explicit.
- No application source or runtime behavior is changed by Phase 1.

Phase 2 requires explicit approval and the real redesign specification/assets.
