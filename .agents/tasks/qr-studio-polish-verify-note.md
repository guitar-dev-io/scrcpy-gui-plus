# QR Studio polish: verification note (iteration 1)

No `qr-studio-polish-review.json` existed, so this is the first iteration. Nothing committed or pushed.

## Commands run and results
- `npx tsc --noEmit`: clean (exit 0).
- `npx vitest run`: 155 files, 906 tests. 904 passed, 2 failed. Both failures are the known pre-existing `src/components/ControlPanel/ControlPanel.test.tsx` renderer tests ("shows auto renderer value by default", "clears renderDriver when selecting auto renderer"). Not touched.
- `npm run build` (tsc && vite build): succeeded.
- `cargo test --lib`: NOT run. No Rust files were touched. Gap 7 was only checked by reading: `src-tauri/Cargo.toml` line 47 has `rqrr = { version = "=0.11.0", default-features = false }`, and `src-tauri/src/deep_link.rs` has `launch_args_quote_the_uri` and `launch_args_quote_the_package_and_keep_constants` tests.

## Quick runtime spot check (Playwright against the running dev server, app in light mode, plain browser so no Tauri)
- 1366x768: Create `data-layout="wide"`, container 1138px. Three columns start at x=269 (Create QR Code), 700 (Live Preview), 1107 (Device Actions and Tools). No horizontal scroll (scrollWidth 1366 = clientWidth). Header title and device selector share one row (tops 76 and 79).
- Light mode headings "Create QR Code", "Live Preview", "Device Actions", "Tools" compute to rgb(245, 247, 250), so they are light text on the navy panels (F1).
- 1024x768: layout `narrow`, no horizontal scroll (1024/1024), all five nav cards fit (rightmost edge 992).
- Not done: screenshots, dark theme runtime check, 1280/1920 viewports, overlay checks in light theme, the 142/2000 record scenes. Those belong to the later visual verification step.

## What changed
- Nav cards (`QrNavCards.tsx`), new header and `QrDeviceCard.tsx` (name select, Connected badge, optional `deviceMeta` prop for Android version, connection and battery; App.tsx does not hold that data, so only name and Connected badge show today).
- Create: wide threshold lowered to container 1060 (`WIDE_FROM`, measured 1138 at 1366). Preview has QR Code / Design View toggle, caption `1024 × 1024 · PNG · Error correction: M`, Download PNG (coral), Download SVG, Copy, then Quality Check, Decode Test, Export Options rows. Aside has Device Actions and Tools cards plus "Open Device Actions" / "Open Tools" buttons wired to `setDestination`.
- F1: `--qr-*` tokens and `.qr-studio-root` in `src/index.css`; every `text-white` / `hover:text-white` in qr-studio replaced with `text-[color:var(--qr-text)]`; guarded by `headingTokens.test.ts`.
- F2: `src/services/tauriRuntime.ts` (`withDesktop`, `friendlyMessage`, `DesktopRequiredError`). Wired into `deepLinkService`, `qrDeviceService`, LivePreview, Decoder, Quality tool, device actions, Create verify and notify paths. Guard is by mapping the TypeError, not by `isTauri()`, so existing service mocks keep working.
- F3: header row is `flex-nowrap` with a truncating subtitle.
- Library: per-type badge colors, card quick actions (Preview, Edit, Copy, Download PNG, Delete red, "..."), real pagination (`LibraryPager.tsx`, 12/24/48/96 per page, page numbers, "Showing a-b of N items"), details Details/Design/Actions tabs. Grid row height 232 to 252 to fit the quick-action row.

## Test changes
New: `QrStudioHeader.test.tsx`, `headingTokens.test.ts`, `tauriRuntime.test.ts`; additions in `QrStudioPage.test.tsx` (3-column composition, toggle, shortcut cards, token scope, Tauri-missing message) and `LibraryPanel.test.tsx` (pagination, quick actions, badges, details tabs). Updated tests that assumed the old windowed status line or the single-scroll details body (they now open the Actions tab first).

## Deviations and still differs
- The reference image is a different product (PandaClassic), so layout was matched to the brief only.
- Pagination replaces the windowed status line; windowing still applies inside a page.
- Design View is a read-only summary of colors, size and error correction.
- Sidebar-dependent threshold: the wide layout relies on the container being at least 1060px.
