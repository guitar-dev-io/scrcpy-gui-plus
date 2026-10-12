# Design Review: QR Studio Refactor (iteration 3)

Reviewed: `.agents/tasks/design.md` against `.agents/tasks/qr-studio-checklist.md` and the source tree. Document review only; no builds or tests were run.

Verdict: CHANGES_REQUESTED (0 HIGH, 2 MEDIUM, 5 NIT)

## Findings

1. MEDIUM. Open-on-Device confirm rule is ambiguous and internally inconsistent (6.0, 2.1).
   - 6.0 says the confirm applies to "decoded or imported" records and to "any content not authored in the Create form in this session". It also says "Records created in Create in the current app run launch without the extra confirm". It also says "`origin: 'decoded'`", while the field is named `source`.
   - `source` is persisted. A record created last week has `source:'created'`, but it was not authored "in the current app run". The rule has two readings, and it is the only guard on a command-injection-adjacent path (untrusted decoded URIs).
   - Unspecified: what `source` becomes when an `imported` or `decoded` record is edited in Create and saved, and what it becomes when duplicated.
   - Fix (single rule):
     ```ts
     const needsLaunchConfirm = (r: QrRecord) => r.source !== 'created'   // undefined => confirm
     ```
     - Drop the "this session" wording and the `origin` name.
     - Editing a record preserves its `source` unless the user changes `content`. In that case the source becomes `'created'` only when the edit happens in the Create form and the content differs from the stored content.
     - Duplicate copies `source`.
     - For the unsaved Create draft, no confirm applies, because the user is typing it.
     - Add reducer tests for these transitions, plus a component test that an `imported` record shows the alertdialog with Cancel focused.

2. MEDIUM. Stacked modal surfaces (Dialog opened over a modal Drawer) have no specified focus-trap or inert behaviour (8.4, 8.5, 8.6, 10.1 "Dialog over drawer").
   - The Drawer and Dialog both live in `#qr-overlay-root`. `inert` is applied only to `#root`, so an open Drawer is not inert while a Dialog is open above it. Two focus traps would fight, and Tab or screen-reader navigation could reach the Drawer under the Dialog.
   - The overlay stack only specifies Escape and outside-click ordering.
   - Fix: the overlay stack owns trapping for all modal surfaces.
     - Only the top-most modal surface (Dialog or modal Drawer) has an active focus trap.
     - When a modal surface becomes non-top, set `inert` on its portal container. Remove it when it becomes top again.
     - Focus restore on close goes to the opener captured at open time, even when that opener is inside another surface.
     - Scroll lock uses a ref-count, and the last release restores `body` styles.
     - Add tests: open Drawer, then Dialog. Tab cycles only inside the Dialog. After closing, focus returns to the Drawer opener element. Escape closes only the Dialog. The scroll lock is released only after both close.

3. NIT. `migrateV1` does not address duplicate `id`s in v1 data (2.2). Duplicate ids break the reducers, selection and React keys.
   - Fix: on a duplicate id, keep the first and give later ones a fresh id. Do not drop them (non-lossy). Add a migration test.

4. NIT. `short_hash` in `qr_send_to_device` is unspecified (6.2). `std::hash::DefaultHasher` is not guaranteed stable across Rust releases, so the "same bytes, same name" claim would not hold across builds.
   - Fix: use the first 4 bytes of SHA-256 (or CRC32) and name the crate or function already in `Cargo.toml`. If neither is present, use an inline FNV-1a 32-bit hash (about 5 lines) and say so.

5. NIT. The enforcement test "greps for `\.svg\b` on records" (2.2) is brittle. It also matches `.svg` filenames and `download.svg`.
   - Fix: replace it with an ESLint `no-restricted-syntax` rule or a typed check (`getRecordSvg` is the only module that imports a `RecordWithSvg` type). Alternatively, scope the grep to `record\.svg|\.svg\)` in `src/components/qr-studio/**` with an explicit allowlist.

6. NIT. The header `Select` value is unspecified when `activeDevice` is non-empty but not in `devices` (device unplugged), or when `''` is active because an iOS or companion workspace is selected (1.1, 1.3). The Select would show an orphan value.
   - Fix: when `activeDevice` is not in `devices`, render the placeholder "Select device". Device Actions treat it as no device, and the selector does not auto-switch.

7. NIT. The 2.5 MB v2 threshold is measured as "serialized payload" without a unit (2.2). localStorage quotas are counted in UTF-16 code units or bytes depending on the engine.
   - Fix: define `const V2_SVG_BUDGET_CHARS = 2_500_000` and compare `JSON.stringify(state).length`.

## Verified Assumptions

- `App.tsx` conditionals at l.1987, 2002 and 2005 are the only `qr-studio` branches in `App.tsx` (grep). The other `qr-studio` references (`appRoutes.ts`, `appRoutes.test.ts`, `OtherPages.tsx`, `AppNavigation.tsx`) are non-hiding mappings. Removing the three conditionals only touches the `qr-studio` branches, and the `shellChromeForRoute` all-true test covers every route.
- The device integration is real, not invented. `activeAndroidWorkspaceDevice` is `''` when `activeIosUdid` or `activeCompanionWorkspaceId` is set (App.tsx l.661-663). `setActiveDevice`, `setActiveIosUdid` and `setActiveCompanionWorkspaceId` exist (l.592-593). The proposed `onSelectDevice` mirrors that pattern without the `handleNavigate('dashboard')` call (l.596). `ToolbarNotifier` is exported from `device-control-toolbar`.
- `launch_deep_link` (`deep_link.rs`) passes `uri` and `pkg` as plain argv to `adb shell am start`. `validate_uri` rejects only empty, over 4096 bytes and control characters. The shell-injection finding in 6.0 is accurate, and the `sh_quote` plus `build_launch_args` fix is feasible.
- `screenshot::capture_png_frame` is `pub(crate)` and takes `(serial, custom_path, timeout_secs)`. `validate_png` and `sanitize_filename_component` are `pub`. `adb::validate_serial` and `adb::run_adb_text` exist.
- `rqrr 0.11.0` exists in the local cargo registry. `rust-version = "1.85.1"`, `default = ["img"]`, `img = ["image"]`, deps `g2p 1.0` and `lru 0.18`, and `prepare_from_greyscale` exists. This matches 7.3. The local `rustc` is 1.96.0, above the MSRV. The decoder decision is concrete: Rust `rqrr`, exact pin, `default-features = false`, no npm dependency.
- Device Actions are honest. Open uses `am start VIEW`. Send is `adb push` to Downloads, with a statement that it does not display the image. Capture uses `screencap` and decodes the screen. Camera scan is a permanently disabled control with an explanation.
- The v1 to v2 migration is non-lossy and testable. The v1 key is never written, there is no consumed marker, `svg` is optional, corrupt and quota paths are specified, and there is a test list.
- The overlay fixes are root-cause. The design identifies overflow clipping, stacking contexts and transform containing blocks. It uses a portal at `body > #qr-overlay-root`, `fixed` plus computed coordinates, new `--z-layer-*` tokens, and a layer host for nested overlays. It does not rely on z-index bumps.
- The only `window.confirm` in `QrStudioPage.tsx` is at line 392, as the design states.

## Unverified / Wrong Assumptions

- Unverified: the visual and layout claims (no clipping, flip behaviour, no horizontal overflow at the five sizes and zoom levels) cannot be verified in jsdom. The design correctly defers them to the manual checklist in 10.1.
- Unverified: `cargo tree -d` showing a single `image` version, and the `lru 0.18` and `g2p` resolution with the project's toolchain. These are gated at implementation time. No code is wrong here.
- Unverified: the Android behaviour of `MEDIA_SCANNER_SCAN_FILE` on API 29+. The design already treats it as best-effort (`scan:false`), so this is acceptable.
- Wrong or inconsistent: the `origin: 'decoded'` versus `source` naming and the "this session" wording in 6.0 (Finding 1).
- Incomplete: the nested-modal behaviour in 8.6 (Finding 2).
