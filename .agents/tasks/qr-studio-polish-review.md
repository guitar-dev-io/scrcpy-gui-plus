# QR Studio polish pass: nav cards, 3-column Create, heading tokens, desktop-only messaging

The pass replaces the pill tablist with five numbered nav cards, adds a third Create column (Device Actions and Tools shortcuts), moves QR panel text onto local `--qr-*` tokens so light themes no longer remap headings to dark-on-navy, maps the raw missing-Tauri TypeError to "Requires the desktop app", and adds library polish (badges, quick actions, pagination, Details/Design/Actions tabs). Verification evidence is present: tsc clean, vitest 904/906 with only the two known ControlPanel renderer failures, build passes, plus a Playwright spot check at 1366 and 1024 in light mode.

Watch for: dark theme and 1280/1920 not runtime-checked (possible, low risk); device card shows only name + Connected because App passes no `deviceMeta` (confirmed); `cargo test` not run (confirmed, no Rust files changed in this diff).

**Verdict**: APPROVED

## High-level view

Navigation is a proper tablist (`role=tablist/tab`, `aria-selected`, roving tabindex, Arrow/Home/End with wraparound). Below a 1280px container width the cards go compact and subtitles become sr-only, which keeps all five in a `grid-cols-5` row with no horizontal scroll (measured at 1024).

F1 is fixed at the root. `.qr-studio-root` defines fixed navy-panel tokens, every `text-white`/`text-zinc-*` in qr-studio was replaced with the token, and `headingTokens.test.ts` fails the build if the remapped utilities come back. A CSS safety net also re-pins those utilities under light mode.

F2 is handled by `tauriRuntime.ts`, which maps the missing-runtime TypeError to `DesktopRequiredError` rather than gating on `isTauri()`, so existing service mocks still work. It is wired into the services and the UI call sites, with a page-level test for the friendly text.

Create uses a wide layout from a 1060px container (1138 measured at 1366) with three visible columns. The header, device card and counters sit on one non-wrapping row. The deep-link shell-quoting fix and `rqrr =0.11.0` are already on the branch from earlier commits and are unchanged here.

<details>
<summary>Issues (3)</summary>

1. **Device meta never supplied** — `QrDeviceCard` accepts `deviceMeta` (Android version, battery) but App.tsx does not pass it, so only name and Connected badge render. Wire it or accept the gap. Non-blocking, confirmed.
2. **Dark theme / 1280 / 1920 not runtime-checked** — the token scope is theme independent by construction, but heading contrast was only measured in light mode. Cover it in the visual verification step. Non-blocking, possible.
3. **Rust fix verified by reading only** — `cargo test --lib` was not run. The code is unchanged in this diff and has `launch_args_quote_*` tests. Non-blocking, confirmed.

</details>

<details>
<summary>Details</summary>

## Nav cards and collapse

Cards carry the subtitles from `destinations.ts` (Generate QR codes, Predefined styles, Test on connected device, Scan · Validate · Convert, Manage & organize). The active card uses the coral gradient. Compact mode keeps subtitles available to assistive tech through `aria-describedby`. `aria-controls` points at `qr-panel-*` ids, which the page uses for its panels.

## Heading tokens

The guard test scans raw sources by glob, so new components are covered automatically. The tokens are scoped to the page root class, so other app pages are unaffected.

## Desktop-required mapping

Matching is by `TypeError` with a message containing invoke or `__TAURI`. A differently worded runtime error would fall through to its raw text (possible, low risk).

## Gaps against the brief

Pagination replaces the windowed status line, and Design View is a read-only summary. The coder notes both as deviations. The pre-existing ControlPanel failures were left untouched. No verification scripts or seed helpers are in src (only test files mention seeding).

</details>

<details>
<summary>File map</summary>

New: QrNavCards, QrDeviceCard, LibraryPager, tauriRuntime (+test), headingTokens.test, QrStudioHeader.test. Modified: QrStudioPage, CreatePanel/CreateAside, library components, qr-studio token swaps, index.css, deepLinkService, qrDeviceService. Run `git diff` for the full diff.

</details>
