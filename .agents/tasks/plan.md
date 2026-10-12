# Implementation Plan: QR Studio refactor

Inputs read: `design.md` (sections 0-14), `design-review.md` (iteration 3, overrides design.md), `qr-studio-checklist.md`, the reference screenshot (downscaled copy at /tmp/qr-ref-small.png; original untouched), `package.json`, `Cargo.toml`, `vite.config.ts`, `src/App.tsx` (l.1987/2002/2005), `deep_link.rs`, `AppShell.tsx`, `ui/index.ts`, the v1 page/service/types/tests. There is no AGENTS.md, CONTRIBUTING.md or `.kiro/steering`.

Machine-readable form of this plan: `.agents/tasks/task-qr-studio-refactor/` (`task.json`, `context.json`, `features/FEAT-001..006.json`). The FEAT files hold the step-level detail; this file is the ordered summary and the finding-to-pass map.

## Decisions and assumptions (recorded, not re-opened)

- Reference image: the file in `refs/` is a screenshot of a third-party device manager (PandaClassic), not a QR Studio mock-up (design Caveat A). The brief's description of the layout is authoritative where it is more specific than design.md. Two adjustments follow, both flagged here:
  - Create uses 3 columns at wide widths (form | live preview with Download PNG/SVG/Copy/Quality/Verify | Device Actions + Tools shortcuts). Rule: measured panel width >= 1200px -> 3 columns; 1024-1199 -> 2 columns; < 1024 -> 1 column. This overrides the 2-column table in design 9 only at the wide end; 1366 and below behave as designed.
  - Library keeps windowing (design 5.5, no "Load more") and adds a status line `Showing a-b of N items` derived from the visible window, which matches the reference's "Showing 1-12 of 142 items" without losing "thousands of records" scale.
- Branch: coders create `feat/qr-studio-refactor` from `main` in FEAT-001 and commit locally per FEAT; nothing is pushed; `.agents/` is never staged.
- NIT 4 hash: `sha2 = "0.11.0"` is already in `Cargo.toml`, so `short_hash` = first 4 bytes of SHA-256 (no FNV fallback).
- NIT 5 enforcement: no ESLint in the repo, so a scoped Vitest check (`svgAccess.test.ts`) scans non-test files under `src/components/qr-studio` with `/\.svg\b(?!['"`])/` and an explicit empty allowlist; `getRecordSvg` in `qrStudioService.ts` is the only accessor.
- Intermediate state: FEAT-004 mounts `data-testid="qr-placeholder"` panels for Library/Device Actions/Tools; FEAT-005 and FEAT-006 remove them; the final review fails if any remain.
- Cargo: the only new dependency is `rqrr = { version = "=0.11.0", default-features = false }`. The user must be told in the final handoff (Cargo.lock is gitignored, so only the `=` pin is committed; local rustc 1.96.0 satisfies MSRV 1.85.1).

## Ordered passes

- [ ] 1. FEAT-001 Data model, migration, store, encoders, quality (no UI).
      Files: `src/types/qrStudio.ts`, `src/services/qrStudioService.ts` (+test), NEW `src/services/qrStudioStore.ts`, `qrEncoders.ts`, `qrQuality.ts` (+tests), NEW `src/components/qr-studio/useQrStore.ts`, `svgAccess.test.ts`; one-line import alias in `src/components/pages/QrStudioPage.tsx` so the v1 page keeps compiling.
      Verify: `npx vitest run src/services src/components/qr-studio src/components/pages/QrStudioPage.test.tsx`, `npx tsc --noEmit`, `npm run build`.

- [ ] 2. FEAT-002 Overlay primitives and `--z-layer-*` tokens (independent of 1; precedes UI).
      Files: `src/index.css` (additive tokens), NEW `src/components/ui/overlay/*` (computePosition, useFloatingPosition, overlayHost, LayerContext, overlayStack, Dialog, ConfirmDialog/useConfirm, Menu, Popover, Select, Tooltip, Drawer + tests), `src/components/ui/index.ts` (additive).
      Verify: `npx vitest run src/components/ui`, `npx tsc --noEmit`, `npm run build`; `git diff --stat main -- src/components/ThemedModal.tsx src/components/Tooltip.tsx` empty.

- [ ] 3. FEAT-003 Rust commands and frontend wrappers (independent of 1-2).
      Files: `src-tauri/Cargo.toml`, `src-tauri/src/deep_link.rs`, NEW `src-tauri/src/qr_device.rs`, `src-tauri/src/lib.rs`, NEW `src/types/qrDevice.ts`, `src/services/qrDeviceService.ts` (+test).
      Verify: `cd src-tauri && cargo test --lib && cargo build`, `cargo tree -e features -i rqrr` (no `img`), `cargo tree -d | grep -i '^image'` (one version), `npx vitest run src/services/qrDeviceService.test.ts src/components/deep-link-launcher`.

- [ ] 4. FEAT-004 Shell, container, header/device selector, Create, Templates. Needs 1, 2, 3.
      Files: `src/App.tsx`, NEW `src/navigation/shellChrome.ts` (+test), NEW `src/components/app-shell/AppShell.test.tsx`, `src/components/pages/QrStudioPage.tsx` (rewritten, <200 lines) + test, NEW `src/components/qr-studio/{destinations,useQrDraft,useContainerWidth,QrStudioHeader,QrDeviceSelect,CreatePanel,TypePicker,TypeFields,DesignControls,LivePreview,QualityPanel,CreateAside,TemplatesPanel,qrDownloads}.ts(x)` and placeholders for Library/DeviceActions/Tools.
      Verify: scoped vitest (navigation, app-shell, qr-studio, page test, services), `npx tsc --noEmit`, `npm run build`, full `npx vitest run`.

- [ ] 5. FEAT-005 Library. Needs 1, 2, 4.
      Files: NEW `src/components/qr-studio/{useWindowedList,useLibrarySelection,LibraryPanel,QrCard,QrRow,QrDetails}.tsx` + tests; container selection hoist in `QrStudioPage.tsx`/`TemplatesPanel.tsx`.
      Verify: `npx vitest run src/components/qr-studio src/components/pages/QrStudioPage.test.tsx`, `npx tsc --noEmit`, `npm run build`.

- [ ] 6. FEAT-006 Device Actions and Tools. Needs 1, 2, 3, 4, 5.
      Files: NEW `src/components/qr-studio/{useDeviceActions,DeviceActionsPanel,ToolsPanel}.tsx` + tests; edits to `CreateAside.tsx`, `QrCard/QrDetails` menus for Open/Send.
      Verify: full `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo test --lib`.

- [ ] 7. Convergence loop (max 3 iterations): fixer runs cross-FEAT integration (full build/tests, final gates `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `cargo build`, `cargo test`) then fixes reviewer findings; reviewer audits the whole diff against design.md + design-review.md and writes `.agents/tasks/review.json`. Stop contract: `verdict == "APPROVED"` in `/Users/anuwat.t/scrcpy-gui-plus/.agents/tasks/review.json`; the reviewer is the loop's last child.

- [ ] 8. Visual verification (manual/semi-automated, design 10.1): screenshots under `.agents/tasks/qr-studio-shots/`, PASS/FAIL/NOT RUN log in `.agents/tasks/qr-studio-verification.md`, `ref-compare.md`. Unrun rows stay NOT RUN and are never claimed.

## Where each review finding is satisfied

| Finding | Pass | Evidence owed |
|---|---|---|
| MEDIUM 1 `needsLaunchConfirm = r.source !== 'created'`, field `source` (no `origin`, no "this session"), edit preserves source unless content changes in Create, duplicate copies, draft no confirm | FEAT-001 (types, rule, reducers, transition tests); FEAT-004 (Create save paths use saveEditedFromCreate); FEAT-006 (alertdialog with Cancel focused for imported/undefined/decoded; draft no confirm) | reducer transition tests; component test |
| MEDIUM 2 stacked modals: single active trap, `inert` on non-top surface, opener-captured focus restore, ref-counted scroll lock | FEAT-002 (`overlayStack.ts`, `stackedModals.test.tsx`: Tab cycles only in Dialog, Drawer inert while Dialog open, Escape closes only Dialog, focus returns to Drawer opener, scroll lock released only after both close) | stackedModals.test.tsx |
| NIT 3 duplicate ids in `migrateV1` (keep first, fresh ids for later, non-lossy) | FEAT-001 | migration test |
| NIT 4 stable hash (SHA-256 first 4 bytes, sha2 already a dependency) | FEAT-003 | Rust test pinning a known vector |
| NIT 5 brittle `.svg` grep | FEAT-001 (`svgAccess.test.ts`, scoped regex + allowlist), re-run in 4/5/6 | test |
| NIT 6 header Select placeholder 'Select device' for '' / unknown serial, no auto-switch, Device Actions = no device | FEAT-004 (`QrDeviceSelect`, `hasAndroidTarget`); FEAT-006 (actions disabled) | component tests |
| NIT 7 `V2_SVG_BUDGET_CHARS = 2_500_000` vs `JSON.stringify(state).length` | FEAT-001 | over-budget migration test |
| Shell-quoting fix (`sh_quote`, `build_launch_args`, tests) | FEAT-003 | cargo test |
| `rqrr =0.11.0`, default-features=false, tell user | FEAT-003 (+ final handoff) | cargo tree checks |
| svg optional + `getRecordSvg` | FEAT-001; used in 4/5/6 | tests + svgAccess |
| Migration corrupt-v1, corrupt-v2, quota; v2 key, v1 never written | FEAT-001 | migration tests |
| Wi-Fi redaction (search key, list, details Reveal) | FEAT-001 (redactWifi, selectors); FEAT-005 (UI); FEAT-006 (generator not persisted) | tests |
| `--z-layer-*` tokens | FEAT-002 | token-order test |
| Remove 3 qr-studio shell conditionals + `shellChromeForRoute` test | FEAT-004 | shellChrome.test.ts, AppShell.test.tsx |
| Camera scan permanently disabled, no fake success | FEAT-006 | test |
| window.confirm / absolute card menus removed | FEAT-002 (primitives), 4 and 5 (usage) | spy tests, portal test |
| Responsive 5 viewports + zoom, no horizontal scroll | FEAT-004/005 (layout rules), step 8 (screenshots) | manual log |

## Risks

- Rust build time on the first `cargo build` after adding rqrr; use long timeouts.
- ADB paths (push/screencap) cannot be tested without a device; only pure helpers are unit-tested and the handoff must say so.
- jsdom cannot verify clipping/overflow/zoom; step 8 must be reported honestly.
