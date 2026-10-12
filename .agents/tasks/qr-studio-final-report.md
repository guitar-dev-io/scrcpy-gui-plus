# QR Studio Refactor + Polish — Final Report

Branch: `feat/qr-studio-refactor` · Workspace: `/Users/anuwat.t/scrcpy-gui-plus`

---

## 1. Summary

QR Studio was rebuilt from a single-page Create + Library view into a five-destination
workspace (Create / Templates / Device Actions / Tools / Library) driven by numbered nav
cards, with a shared, portal-based overlay layer, theme-safe navy panels, a full data model
(12 content types, folders, tags, notes, Trash), device actions over ADB, and desktop-only
messaging for Tauri-backed features. This final pass added the nav cards, a 3-column Create
layout (form | Live Preview | Device Actions + Tools), local `--qr-*` text tokens so light
themes no longer render dark-on-navy headings, friendly "Requires the desktop app" mapping,
and library polish (badges, quick actions, pagination, Details/Design/Actions tabs).

Implementation was already complete and uncommitted when this step began. This step
re-verified the suite, visually inspected a representative set of the ~79 captured
screenshots (after downscaling to avoid the >2000px image limit that crashed the prior
visual-verify step), confirmed dark-theme heading contrast by rendering, wrote this report,
and committed the work as a single commit. No features were re-implemented. Nothing was pushed.

---

## 2. Files modified

### `git diff --stat main..HEAD` (committed on the branch)

```
 scripts/build-portable.ps1                           |   4 +-
 src-tauri/Cargo.toml                                 |   1 +
 src-tauri/src/commands.rs                            |  12 +-
 src-tauri/src/deep_link.rs                           |  87 +-
 src-tauri/src/lib.rs                                 |   4 +
 src-tauri/src/qr_device.rs                           | 624 ++++++++++++++
 src/App.tsx                                          |  24 +-
 src/components/app-shell/AppShell.test.tsx           |  27 +
 src/components/pages/QrStudioPage.test.tsx           | 618 ++++++++++++--
 src/components/pages/QrStudioPage.tsx                | 826 +++++--------------
 src/components/qr-studio/BulkBar.tsx                 | 161 ++++
 src/components/qr-studio/CreateAside.tsx             |  27 +
 src/components/qr-studio/CreatePanel.test.tsx        | 324 ++++++++
 src/components/qr-studio/CreatePanel.tsx             | 553 +++++++++++++
 src/components/qr-studio/CreatePanelDevice.test.tsx  | 103 +++
 src/components/qr-studio/DecoderTool.tsx             | 172 ++++
 src/components/qr-studio/DeepLinkBuilderTool.tsx     | 187 +++++
 src/components/qr-studio/DesignControls.tsx          | 137 ++++
 src/components/qr-studio/DeviceActionsAside.tsx      |  88 ++
 src/components/qr-studio/DeviceActionsPanel.test.tsx | 607 ++++++++++++++
 src/components/qr-studio/DeviceActionsPanel.tsx      | 370 +++++++++
 src/components/qr-studio/DeviceParts.tsx             | 135 ++++
 src/components/qr-studio/FolderRail.tsx              | 123 +++
 .../qr-studio/LibraryDeviceActions.test.tsx          | 190 +++++
 src/components/qr-studio/LibraryDialogs.tsx          | 270 +++++++
 src/components/qr-studio/LibraryPanel.test.tsx       | 679 ++++++++++++++++
 src/components/qr-studio/LibraryPanel.tsx            | 893 +++++++++++++++++++++
 src/components/qr-studio/LivePreview.tsx             | 113 +++
 src/components/qr-studio/QrCard.tsx                  |  67 ++
 src/components/qr-studio/QrDetails.tsx               | 309 +++++++
 src/components/qr-studio/QrDeviceSelect.test.tsx     |  74 ++
 src/components/qr-studio/QrDeviceSelect.tsx          |  52 ++
 src/components/qr-studio/QrRow.tsx                   |  63 ++
 src/components/qr-studio/QrStudioHeader.tsx          | 135 ++++
 src/components/qr-studio/QrThumb.tsx                 |  78 ++
 src/components/qr-studio/QualityPanel.tsx            |  66 ++
 src/components/qr-studio/QualityTool.tsx             | 172 ++++
 src/components/qr-studio/RecordParts.tsx             | 167 ++++
 src/components/qr-studio/StoreBanners.tsx            |  34 +
 src/components/qr-studio/TemplatesPanel.test.tsx     | 158 ++++
 src/components/qr-studio/TemplatesPanel.tsx          | 256 ++++++
 src/components/qr-studio/ToolsPanel.test.tsx         | 271 +++++++
 src/components/qr-studio/ToolsPanel.tsx              | 133 +++
 src/components/qr-studio/TypeFields.tsx              | 185 +++++
 src/components/qr-studio/TypePicker.tsx              |  41 +
 src/components/qr-studio/WifiTool.tsx                | 116 +++
 src/components/qr-studio/deepLinkBuilder.test.ts     |  67 ++
 src/components/qr-studio/deepLinkBuilder.ts          |  84 ++
 src/components/qr-studio/destinations.ts             |  31 +
 src/components/qr-studio/deviceTargets.ts            |  37 +
 src/components/qr-studio/deviceText.ts               |   3 +
 src/components/qr-studio/formControls.tsx            | 163 ++++
 src/components/qr-studio/libraryUtils.ts             |  82 ++
 src/components/qr-studio/qrBulk.ts                   |  91 +++
 src/components/qr-studio/qrDownloads.ts              |  97 +++
 src/components/qr-studio/svgAccess.test.ts           |  38 +
 src/components/qr-studio/useContainerWidth.ts        |  31 +
 src/components/qr-studio/useDeviceActions.tsx        | 339 ++++++++
 src/components/qr-studio/useLibrarySelection.ts      |  79 ++
 src/components/qr-studio/useQrDraft.ts               | 146 ++++
 src/components/qr-studio/useQrStore.test.tsx         | 160 ++++
 src/components/qr-studio/useQrStore.ts               | 155 ++++
 src/components/qr-studio/useWindowedList.test.ts     |  67 ++
 src/components/qr-studio/useWindowedList.ts          | 133 +++
 src/components/ui/index.ts                           |  19 +
 src/components/ui/overlay/ConfirmDialog.tsx          | 110 +++
 src/components/ui/overlay/Dialog.test.tsx            | 203 +++++
 src/components/ui/overlay/Dialog.tsx                 |  99 +++
 src/components/ui/overlay/Drawer.tsx                 |  78 ++
 src/components/ui/overlay/LayerContext.tsx           |  16 +
 src/components/ui/overlay/Menu.test.tsx              | 138 ++++
 src/components/ui/overlay/Menu.tsx                   | 296 +++++++
 src/components/ui/overlay/Popover.test.tsx           |  73 ++
 src/components/ui/overlay/Popover.tsx                | 158 ++++
 src/components/ui/overlay/Select.test.tsx            |  80 ++
 src/components/ui/overlay/Select.tsx                 | 277 +++++++
 src/components/ui/overlay/Surface.tsx                | 134 ++++
 src/components/ui/overlay/Tooltip.test.tsx           | 105 +++
 src/components/ui/overlay/Tooltip.tsx                | 124 +++
 src/components/ui/overlay/computePosition.test.ts    | 107 +++
 src/components/ui/overlay/computePosition.ts         | 108 +++
 src/components/ui/overlay/overlayHost.ts             |  15 +
 src/components/ui/overlay/overlayStack.test.tsx      |  55 ++
 src/components/ui/overlay/overlayStack.ts            | 321 ++++++++
 src/components/ui/overlay/overlayUtils.ts            |  44 +
 src/components/ui/overlay/stackedModals.test.tsx     | 147 ++++
 src/components/ui/overlay/testUtils.ts               |  33 +
 src/components/ui/overlay/useFloatingPosition.ts     | 146 ++++
 src/components/ui/overlay/zTokens.test.ts            |  37 +
 src/index.css                                        | 329 ++++++--
 src/navigation/shellChrome.test.ts                   |  22 +
 src/navigation/shellChrome.ts                        |  16 +
 src/services/qrDeviceService.test.ts                 |  48 ++
 src/services/qrDeviceService.ts                      |  29 +
 src/services/qrEncoders.test.ts                      | 319 ++++++++
 src/services/qrEncoders.ts                           | 459 +++++++++++
 src/services/qrQuality.test.ts                       |  72 ++
 src/services/qrQuality.ts                            | 111 +++
 src/services/qrStudioService.test.ts                 | 279 ++++++-
 src/services/qrStudioService.ts                      | 361 ++++++++-
 src/services/qrStudioStore.test.ts                   | 362 +++++++++
 src/services/qrStudioStore.ts                        | 511 ++++++++++++
 src/types/qrDevice.ts                                |  29 +
 src/types/qrStudio.ts                                |  94 ++-
 104 files changed, 16657 insertions(+), 846 deletions(-)
```

### `git diff --stat` (uncommitted at the start of this step — the polish pass)

```
 src/components/pages/QrStudioPage.test.tsx           |  84 ++++++++++--
 src/components/pages/QrStudioPage.tsx                |   8 +-
 src/components/qr-studio/BulkBar.tsx                 |   2 +-
 src/components/qr-studio/CreateAside.tsx             |  35 ++++-
 src/components/qr-studio/CreatePanel.tsx             | 150 ++++++++++++++-------
 src/components/qr-studio/DecoderTool.tsx             |   3 +-
 src/components/qr-studio/DeviceActionsPanel.tsx      |   6 +-
 src/components/qr-studio/FolderRail.tsx              |  12 +-
 .../qr-studio/LibraryDeviceActions.test.tsx          |   4 +
 src/components/qr-studio/LibraryDialogs.tsx          |   2 +-
 src/components/qr-studio/LibraryPanel.test.tsx       | 121 ++++++++++++-----
 src/components/qr-studio/LibraryPanel.tsx            |  44 ++++--
 src/components/qr-studio/LivePreview.tsx             |  11 +-
 src/components/qr-studio/QrCard.tsx                  |  12 +-
 src/components/qr-studio/QrDetails.tsx               | 102 +++++++++++---
 src/components/qr-studio/QrRow.tsx                   |   2 +-
 src/components/qr-studio/QrStudioHeader.tsx          | 136 ++++++-------------
 src/components/qr-studio/QualityPanel.tsx            |   2 +-
 src/components/qr-studio/QualityTool.tsx             |   3 +-
 src/components/qr-studio/RecordParts.tsx             |  29 +++-
 src/components/qr-studio/TemplatesPanel.tsx          |   4 +-
 src/components/qr-studio/ToolsPanel.tsx              |   6 +-
 src/components/qr-studio/destinations.ts             |  11 +-
 src/components/qr-studio/formControls.tsx            |  10 +-
 src/components/qr-studio/libraryUtils.ts             |  20 ++-
 src/components/qr-studio/useDeviceActions.tsx        |   3 +-
 src/components/qr-studio/useWindowedList.ts          |   2 +-
 src/index.css                                        |  43 ++++++
 src/services/deepLinkService.ts                      |   7 +-
 src/services/qrDeviceService.ts                      |   9 +-
 30 files changed, 606 insertions(+), 277 deletions(-)
```

Newly added files in the polish pass (untracked before commit): `LibraryPager.tsx`,
`QrDeviceCard.tsx`, `QrNavCards.tsx`, `QrStudioHeader.test.tsx`, `headingTokens.test.ts`,
`tauriRuntime.ts`, `tauriRuntime.test.ts`.

---

## 3. Features implemented — DONE / PARTIAL / NOT DONE

Mirrors the 19-item audit in `.agents/tasks/qr-studio-checklist.md`. The checklist recorded
the pre-implementation state (DONE 2 / PARTIAL 7 / NOT DONE 10). After the refactor + polish
the state is **DONE 19 / PARTIAL 0 / NOT DONE 0** (web/renderer scope; Rust device paths are
exercised by unit tests + mocks, not by a live device — see §8).

| #  | Item | Before | After | Evidence |
|----|------|--------|-------|----------|
| 1  | 5 destinations shown one at a time | NOT DONE | DONE | `QrNavCards.tsx` tablist + `QrStudioPage.tsx` panels `qr-panel-*` |
| 2  | Header + device selector, shell kept | NOT DONE | DONE | `shellChrome.ts` returns full chrome for every route; `QrDeviceSelect.tsx` |
| 3  | Dark navy + coral-red styling | PARTIAL | DONE | `--qr-panel:#0d1725`, `--qr-coral:#ff4f57`; dark + light screenshots |
| 4  | Library search/filter/sort/grid-list/multi-select/bulk/pagination | PARTIAL | DONE | `LibraryPanel.tsx`, `BulkBar.tsx`, `LibraryPager.tsx`, `useWindowedList.ts` |
| 5  | Folders (All/Uncat/custom/Fav/Recent/Trash, CRUD, move) | NOT DONE | DONE | `FolderRail.tsx`, `qrStudioStore.ts` (folderId, trashedAt) |
| 6  | Tags | NOT DONE | DONE | `qrStudioStore.ts` tags, Manage tags dialog (`LibraryDialogs.tsx`) |
| 7  | QR cards (checkbox, preview, move, etc.) | PARTIAL | DONE | `QrCard.tsx`, `QrRow.tsx`, `RecordParts.tsx` |
| 8  | Details sidebar | NOT DONE | DONE | `QrDetails.tsx` + Drawer; Details/Design/Actions tabs |
| 9  | localStorage + migration | PARTIAL | DONE | `qrStudioStore.ts` schema with folders/tags/notes/trashedAt; store tests |
| 10 | Create: 12 types, single/bulk, design, validation, PNG/SVG, save | PARTIAL | DONE | `qrStudio.ts` 12 `QrContentType`, `qrEncoders.ts`, `TypeFields.tsx`, `CreatePanel.tsx` |
| 11 | Templates (style presets) | NOT DONE | DONE | `TemplatesPanel.tsx` (+ test) |
| 12 | Device Actions (Send/Open/Capture & Decode/deep-link test) | NOT DONE | DONE | `DeviceActionsPanel.tsx`, `useDeviceActions.tsx`, `qr_device.rs`, `deep_link.rs` |
| 13 | Tools (Deep Link Builder, Wi-Fi, decoder, quality) | PARTIAL | DONE | `DeepLinkBuilderTool.tsx`, `WifiTool.tsx`, `DecoderTool.tsx`, `QualityTool.tsx` |
| 14 | Overlay policy (portal, collision, focus trap/restore, z-audit) | NOT DONE | DONE | `src/components/ui/overlay/*` (`overlayHost.ts` `#qr-overlay-root`, `--z-layer-*`) |
| 15 | Every control has a handler | PARTIAL | DONE | panel + overlay test suites exercise controls |
| 16 | Responsive 5 sizes + zoom | NOT DONE | DONE | shots-v2: 1024/1280/1366/1536/1920 + emulated zoom 80/100/125/150 |
| 17 | Automated tests | PARTIAL | DONE | 155 test files; qr-studio + overlay suites added |
| 18 | Run build/test | DONE | DONE | see §6 (vitest 904/906, tsc clean, build clean) |
| 19 | Screenshot / visual verification | NOT DONE | DONE | ~79 shots in `qr-studio-shots-v2/`; inspected set in §7 |

---

## 4. Overlay issues found + root causes

Sources: `.agents/tasks/design.md` (§8) and `.agents/tasks/qr-studio-verification.md`.
Content was rephrased for compliance with licensing restrictions.

- **Clipped card menus (overflow + stacking context).** The card action menu was `absolute`
  inside the card, nested under `<main>` which is `overflow-y-auto`, and under the AppShell
  root that carries an opacity animation (`forwards` fill) forming its own stacking context.
  Menus were therefore clipped by the overflow ancestor — a stacking-context problem, not just
  a low z-index.
- **Ad-hoc z-index.** Layering used `--z-sidebar/-topbar/-drawer/-modal` plus ~20 one-off
  literals (`z-[100]`, `z-[300]`, `z-[999]`, …). `ThemedModal` was `fixed z-[300]`, not
  portaled, with no focus trap; `Tooltip` was `absolute z-[100]`, not clamped to the viewport.
- **Transforms / absolute positioning.** Tooltips and the absolute card menu were not
  collision-aware, so near a right/bottom edge they overflowed or were clipped.
- **`window.confirm` for destructive actions.** Deletion used the native `window.confirm`
  dialog, which is unstyled, blocks the thread, and cannot participate in the app's focus or
  layer model.

Solution (design.md §8): a dedicated overlay layer. `getOverlayHost()` lazily creates
`body > #qr-overlay-root` (a sibling of `#root`, outside the animated/overflow AppShell root);
all primitives (Dialog, Drawer, Menu, Popover, Select, Tooltip) portal there. A single ordered
z-scale (`--z-layer-base … --z-layer-critical`, 0 → 1400) replaces the ad-hoc literals, with a
Vitest guard (`zTokens.test.ts`) asserting token order. Modal surfaces apply a focus trap
(save/restore `activeElement`, Tab cycling), `inert`/`aria-hidden` on `#root`, and a body
scroll lock (with scrollbar-width padding compensation), all restored on close.

---

## 5. How each was fixed

- **Clipping / stacking:** menus, dialogs, drawers, tooltips, selects, popovers now render in
  `#qr-overlay-root` via the overlay primitives, so no overflow/transform ancestor can clip
  them. Verified in screenshot scenes A (card-menu-last-card) and B (tooltip-right-edge).
- **Collision:** `computePosition.ts` / `useFloatingPosition.ts` clamp overlays to the viewport
  (menu flips upward near the bottom, tooltip stays inside the right edge). Verified in scenes
  A and B.
- **z-index audit:** `--z-layer-*` tokens in `index.css`; within a dialog/drawer the layer host
  sits above the panel in the same local stacking context, so ordering holds regardless of the
  numeric values. Verified in scene D (dialog/actions over the dimmed drawer backdrop).
- **`window.confirm` removed:** replaced by `ConfirmDialog`/`Dialog` with sticky footer and
  focus management. Long dialog verified in scene C (Close/Confirm stay visible while the body
  scrolls).
- **Heading contrast (prior finding F1):** QR panels keep fixed navy tokens
  (`.qr-studio-root --qr-text:#f5f7fa` on `--qr-panel:#0d1725`); every `text-white`/`text-zinc-*`
  in qr-studio was swapped to the token, guarded by `headingTokens.test.ts`, with a light-mode
  CSS safety net. Verified in the ultraviolet-light and dark captures.
- **Missing-Tauri error (prior finding F2):** `tauriRuntime.ts` maps the missing-runtime
  `TypeError` to `DesktopRequiredError`, surfaced as "Requires the desktop app" instead of the
  raw `invoke` TypeError. Verified in the Create captures.

---

## 6. Build / test results

Exact commands run in this step, with real outcomes:

| Command | Outcome |
|---------|---------|
| `npx vitest run` | **904 passed, 2 failed** (906 total; 1 failed file of 155). The 2 failures are both in `src/components/ControlPanel/ControlPanel.test.tsx` → "ControlPanel renderer selector" ("shows auto renderer value by default" and "clears renderDriver when selecting auto renderer"). Pre-existing, also fail on `main`; not touched by this change. |
| `npx tsc --noEmit` | **Clean** — exit 0, no diagnostics. |
| `npm run build` (`tsc && vite build`) | **Clean** — 2286 modules transformed, built in ~2.15s, no errors. |

`cargo test` for the Rust device/deep-link code was **not run** in this step (no Rust files
changed in the uncommitted polish diff; the Rust changes landed earlier on the branch and carry
`launch_args_quote_*` tests). This is recorded as a limitation in §8.

---

## 7. Screenshot paths

All captures live in `/Users/anuwat.t/scrcpy-gui-plus/.agents/tasks/qr-studio-shots-v2/`
(~79 PNGs). To avoid the >2000px image limit that crashed the previous visual-verify step,
each inspected shot was first downscaled with `sips -Z 1400 <src> --out /tmp/qrshots/<name>`
and the 1400px copy was viewed (originals were never opened directly). The `/tmp/qrshots`
copies were deleted at the end of this step.

Scenes actually inspected this step (one line each, what I saw vs the brief):

- `1920x1080-100-library.png` — list view, nav cards, folders, type filters, pager "1-12 of 142". Matches brief. **PASS**
- `1366x768-100-library.png` — same layout at 1366, no overflow, header counters on one row. **PASS**
- `1920x1080-100-create.png` — 3 columns (Create form | Live Preview | Device Actions + Tools), desktop-required notice. **PASS (3 columns visible)**
- `1366x768-100-create.png` — 3 columns still visible at 1366; camera-scan disabled with explanation. **PASS (3 columns visible)**
- `1366x768-100-scene-a-card-menu-last-card.png` — rightmost card menu fully inside viewport, all items visible, not clipped. **PASS**
- `1366x768-100-scene-b-tooltip-flush-right-edge.png` — "Download PNG" tooltip clamped inside the right edge, not clipped. **PASS**
- `1280x720-100-scene-c-long-dialog-manage-tags.png` — Manage tags dialog: title, ✕, New tag/ADD TAG and sticky CLOSE footer all visible. **PASS**
- `1280x720-100-scene-c-long-dialog-manage-tags-scrolled.png` — scrolled to bulk-tag-89, sticky CLOSE footer stays pinned/visible. **PASS (Close/Confirm visible)**
- `1024-100-scene-d-details-drawer.png` — details drawer over dimmed backdrop, Details tab content legible, ✕ visible. **PASS**
- `zoom150-1280x720-scene-d-details-drawer-actions.png` — Actions tab over backdrop: Edit/Duplicate/Download PNG+SVG/Move to Trash + disabled device actions with messaging, no clipping. **PASS (dialog-over-drawer)**
- `1366x768-100-create-ultraviolet-dark.png` — dark theme: panel headings near-white on navy, legible. **PASS**
- `1366x768-100-create-emerald-dark.png` — dark theme: same, panels stay navy regardless of accent. **PASS**
- `1366x768-100-create-ultraviolet-light.png` — light theme: headings near-white on navy panels (prior F1 contrast failure resolved). **PASS**
- `1366x768-100-f2-create-desktop-required.png` — "Requires the desktop app" friendly message shown, no raw invoke TypeError. **PASS**

No clear visual bug was found in the inspected set, so no CSS tweaks were made in this step.

---

## 8. Remaining limitations and unsupported device actions

- **Camera scan cannot be forced by ADB.** The device-camera scan control is permanently
  disabled with an on-screen explanation: this app drives devices over ADB and has no access to
  a device camera feed; users capture the on-device screen (Capture & Decode) or scan the
  on-screen QR with a phone.
- **Send to Device** pushes a PNG to the device's Downloads folder; it does not open or display
  the image on the device.
- **Zoom levels were EMULATED** by scaling the CSS viewport (e.g. 2400×1350 / 1536×864 /
  1280×720 for 80 / 125 / 150%), not real browser zoom.
- **Web/browser build has no Tauri runtime**, so device/decoder features that call `invoke` are
  only covered by unit tests + mocks unless a real device is attached. `cargo test` for the Rust
  paths was not run in this step.
- **Device card shows only name + Connected badge.** `QrDeviceCard` accepts `deviceMeta`
  (Android version, battery) but `App.tsx` does not pass it, so those fields are not rendered.
- **Reference image mismatch.** `refs/` contains a different product (PandaClassic), so visual
  matching was done against the written brief, not that image.
- **New Rust dependency:** `rqrr = "=0.11.0"` with `default-features = false`
  (`src-tauri/Cargo.toml`), used for QR decoding over the project's own greyscale image data.
- **Security fix — `launch_deep_link` shell quoting:** `adb shell` re-parses its joined
  arguments with the device shell, so the deep-link URI and optional package are now
  single-quoted via `sh_quote` (`'…'` with embedded `'` rewritten as `'\''`) in
  `build_launch_args` (`src-tauri/src/deep_link.rs`), preventing `&`, `;`, `|`, `$()` and
  backticks from being interpreted on the device.
