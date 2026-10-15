# Fix plan: "Open on all devices" broadcast button gets covered

## Scope and mode

No approved design document was handed to this step, so the design decisions
below are mine, grounded in the code I read. Each decision carries a one or two
sentence rationale. The task is a user-reported **visual overlap** bug: another
element paints on top of the broadcast button in the QR Studio "Device Actions"
tab. Reading the code strongly narrows the suspects, but a visual overlap cannot
be fully proven in jsdom, so the plan ends with a mandatory browser reproduction
+ fix step. Do **not** close this as "already works" from code reading alone.

## What I read (grounding)

- `src/components/qr-studio/DeviceActionsPanel.tsx` — the "Deep link test" card
  holds the broadcast `ActionButton` (`outlineButtonClass`) and, directly below
  it, `<ResultStrip label="Last broadcast result">`. The card is the **last**
  child of `<div className="grid gap-4 xl:grid-cols-2">`, i.e. the bottom-most
  card in the 2-column grid; the panel wrapper is
  `<div className="space-y-4 p-4 lg:p-6">`.
- `src/components/qr-studio/DeviceParts.tsx` — `ActionButton` renders
  `<div className="flex flex-col items-start gap-1">` with the `<button>` and an
  optional reason `<p>`. No positioning, no z-index. `ResultStrip` is a plain
  `<p className="mt-2 ...">`. Neither creates a stacking context.
- `src/components/qr-studio/DeviceActionsAside.tsx` — mirrors the same broadcast
  `ActionButton` + `ResultStrip` pattern (compact Create aside).
- `src/components/pages/QrStudioPage.tsx` — the page root is
  `<div className="relative flex h-full min-h-0 flex-1 flex-col ... qr-studio-root">`.
  Its children: `QrStudioHeader` (**not** sticky/fixed — a `shrink-0` flex
  child, see below), `StoreBanners`, the scrollable
  **tabpanel** `<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">`
  that hosts `DeviceActionsPanel`, and finally a **status-toast region**:
  `<div role="status" aria-live="polite" className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">{status && <p ...>}</div>`.
  `status` is set by every `onStatus(...)` call and auto-clears after
  `STATUS_MS = 2400`.
- `src/components/qr-studio/QrStudioHeader.tsx` — `<header className="shrink-0 ...">`,
  normal flow, no sticky/fixed; rules it out as the cover.
- `src/components/qr-studio/useDeviceActions.tsx` — broadcast path:
  `openOnAllDevices` → (for typed URIs, `confirm` is false) → `broadcast(...)` →
  `execute('broadcast', ...)`; on success it calls
  `onStatus?.('Opened on N of M devices')` **and** sets the `broadcast`
  ResultStrip to success. `onStatus` is the status toast in `QrStudioPage`. The
  launch confirmation (`launchDialog`) is a portal `Dialog` and only appears for
  `confirm` targets (not typed deep links), so it is not the usual cover here.
- `src/App.tsx` — `notify` → `showAlert` renders a **centered** `ThemedModal`
  (`fixed inset-0 z-[300]`). `useDeviceActions.execute` only calls `notify` on
  failure **and** only when no modal is already open; a successful broadcast
  does not open the ThemedModal.
- `src/components/app-shell/AppShell.tsx` — `<main className="... overflow-y-auto">`
  is the outer scroll container; the shell footer is a `shrink-0` **sibling after**
  `main` (`z-[var(--z-topbar)]`), so it reserves its own space and does not
  overlap scrolled content.
- `src/components/Footer.tsx` — `<footer className="... lg:hidden">`: a bottom
  dock that only renders below the `lg` breakpoint and is in normal flow. Not a
  desktop overlap source.
- `src/index.css` — overlay z-scale tokens `--z-layer-*` (`:root`, lines ~95-105):
  `--z-layer-base:0`, `-raised:10`, `-sticky-nav:30`, `-dropdown:1000`,
  `-popover:1050`, `-tooltip:1100`, `-drawer-backdrop:1200`, `-drawer:1210`,
  `-dialog-backdrop:1300`, `-dialog:1310`, `-critical:1400`. Legacy app layers
  `--z-sidebar:30`, `--z-topbar:40`, `--z-modal:300`. `.qr-studio-root` (lines
  ~543-550) sets only color tokens — **no `transform`, `filter`, `perspective`,
  `will-change`, `contain`, or `isolation`** — so it does not become a containing
  block for `fixed` elements and the `ThemedModal`'s `fixed` positioning is
  relative to the viewport as intended.
- `src/components/ui/overlay/Select.tsx` / `overlayStack.ts` — the card `Select`
  dropdowns portal into the overlay host at `z-[var(--z-layer-dropdown)]` (1000),
  far from the broadcast button and only while open; not the cover.
- `src/components/qr-studio/DeviceActionsPanel.test.tsx` — existing tests do
  **not** reference the broadcast button at all (no `broadcast`/`Open on all`
  assertions). This is the test file to extend.

## Root-cause decision

Decision: the covering element is the **QrStudioPage status-toast region**
(`role="status"`, `absolute bottom-4 left-1/2 z-10` in `QrStudioPage.tsx`), not
the `ThemedModal`, not the header, not the shell footer, not a dropdown.
Rationale: it is the only element that (a) is positioned (`absolute`) and
z-raised (`z-10`) over the panel, (b) is pinned to `bottom-4` center of the page
root exactly where the bottom-most card's broadcast button sits when the panel
is scrolled to the end, and (c) appears **in response to the interaction** — the
broadcast success path fires `onStatus('Opened on N of M devices')`, which is
precisely the "when I press the button it gets covered" symptom the user
reported, and matches the "another element overlaps on top of the button"
category (not clipping, not wrapping). The toast's background `<p>` is opaque
(`bg-[#0d1725]`), so it visually hides the button/ResultStrip beneath it for
~2.4s. The container is `pointer-events-none`, so it blocks the *view* but not
clicks; that is consistent with a purely visual "โดนบัง" complaint.

Why not the other suspects (recorded so the implementer does not chase them):

- `ThemedModal` (`z-[300]`, centered, `fixed`): a centered modal over the panel
  is expected and only opens on failure; a successful typed-link broadcast does
  not open it. Its `fixed` positioning is correct because `.qr-studio-root`
  creates no containing block. Leave it unchanged.
- Sticky/fixed header: `QrStudioHeader` is `shrink-0` in a flex column, not
  sticky; it sits above the scroll area, never over its bottom.
- Shell footer / `Footer`: siblings in normal flow (and `lg:hidden`); no overlap.
- Stacking-context inversion on the button: `ActionButton`/`ResultStrip` set no
  position or z-index, so a sibling card cannot legitimately paint over them;
  the grid cards do not overlap geometrically.

## Design of the fix (root cause, token-aligned)

The status toast must float above normal panel content (that is its job) but
must not *obscure* an interactive control sitting at the bottom of the scroll
area. Two coordinated changes:

1. Give the bottom-most card enough bottom clearance that the toast never lands
   on the broadcast button/ResultStrip, by reserving space at the end of the
   scrollable panel equal to the toast's height + its `bottom-4` offset. This is
   the real fix: the toast is a transient status affordance and should occupy the
   gutter below the content, not sit on top of content. Implement as bottom
   padding on the Device Actions panel wrapper (and the equivalent gutter in the
   aside), scoped so it does not disturb other tabs.
2. Align the toast's z-index with the documented token scale instead of the
   ad-hoc `z-10`. The toast is a transient non-modal status surface; map it to
   `--z-layer-raised` (10) via the token (`style={{ zIndex: 'var(--z-layer-raised)' }}`
   or a `z-[var(--z-layer-raised)]` utility). This keeps it above base content
   but below every portal overlay (dropdown 1000, dialog 1310, modal 300),
   preserving correct ordering with the launch `Dialog` and `ThemedModal`.
   Rationale: the brief forbids ad-hoc high z-index; `z-10` happens to equal the
   token value, so this is a semantics/consistency fix, and the real overlap fix
   is the clearance in step 1, not a z-index bump.

Decision — keep the toast where it is (bottom-center of the page), rather than
relocating it, because it is shared by all five tabs and relocation would be a
larger visual change the user did not ask for; adding bottom clearance in the
Device Actions panel is the minimal, local, root-cause fix. If browser
verification (step 4) shows the toast is NOT the cover, the implementer must
identify the actual covering element with DevTools and fix it at its root
following these same token/overlay conventions before touching anything else.

## What must NOT regress

- The single-device **"Open link on device"** button and its "Last deep link
  result" ResultStrip in the same card.
- All other ResultStrips (send / open / capture / decoded / broadcast) still
  render and update.
- The launch confirmation `Dialog` (`useDeviceActions.launchDialog`) and the
  App-level `ThemedModal` behavior (centered, backdrop, focus) — unchanged.
- The status toast still appears, is still announced (`role="status"
  aria-live="polite"`), still auto-clears after 2400ms, and still works on the
  other four tabs (Create / Templates / Tools / Library).
- The compact **aside** (`DeviceActionsAside.tsx`) broadcast button + ResultStrip.
- No new containing block / `transform` / `isolation` on `.qr-studio-root` or the
  panel that could break the `fixed` ThemedModal or portaled overlays.

## Build / test commands (from package.json)

- Type-check: `npm run lint` (`tsc --noEmit`)
- Unit tests: `npm test` (`vitest run`); scope with
  `npx vitest run src/components/qr-studio src/components/pages`
- Full build: `npm run build` (`tsc && vite build`)
- Browser run for visual verification: `npm run dev` (Vite); the app is a Tauri
  app, device actions need the desktop runtime, but the **layout/overlap** is
  reproducible in the browser dev server by navigating to QR Studio → Device
  Actions and scrolling to the "Deep link test" card.

---

# Implementation Plan

- [ ] 1. Add a regression test that the broadcast button and its "Last broadcast
      result" ResultStrip render and are reachable in the Device Actions panel,
      and that triggering a status message does not remove/replace them. This
      locks in the structure before the layout change (jsdom cannot assert pixel
      overlap, so this test guards presence/structure, and the browser step 4
      covers the visual overlap).
      Files: `src/components/qr-studio/DeviceActionsPanel.test.tsx`
      Verify: `npx vitest run src/components/qr-studio/DeviceActionsPanel.test.tsx`
      — the new test passes and no existing test breaks.

- [ ] 2. Reserve bottom clearance in the Device Actions panel so the bottom-center
      status toast never lands on the broadcast button/ResultStrip. Add bottom
      padding to the panel wrapper `<div className="space-y-4 p-4 lg:p-6">` in
      `DeviceActionsPanel.tsx` (e.g. append `pb-16` / a value ≥ toast height +
      its `bottom-4` offset) and apply the same gutter to the aside's scroll
      container in `DeviceActionsAside.tsx` if it can scroll to its broadcast
      button. Do not add `transform`/`isolation`.
      Files: `src/components/qr-studio/DeviceActionsPanel.tsx`,
      `src/components/qr-studio/DeviceActionsAside.tsx`
      Verify: `npx vitest run src/components/qr-studio src/components/pages` passes;
      `npm run lint` clean.

- [ ] 3. Replace the status toast's ad-hoc `z-10` with the overlay token so its
      stacking is documented and intentional. In `QrStudioPage.tsx`, change the
      status region's `z-10` to the `--z-layer-raised` token (utility
      `z-[var(--z-layer-raised)]` or inline `style={{ zIndex: 'var(--z-layer-raised)' }}`).
      Do not introduce a high ad-hoc z-index. Confirm it still sits below the
      portaled `Dialog`/`Select` (≥1000) and the `ThemedModal` (300).
      Files: `src/components/pages/QrStudioPage.tsx`
      Verify: `npx vitest run src/components/pages` passes; `npm run lint` clean.

- [ ] 4. REQUIRED browser reproduction and confirmation. Run `npm run dev`, open
      QR Studio → "Device Actions", scroll the panel to the "Deep link test"
      card, type a URI, and trigger "Open on all devices" (or trigger any
      `onStatus` message while the broadcast button is at the bottom of the
      viewport). Using browser DevTools, confirm (a) the pre-fix overlap: the
      bottom-center status `<p>` paints over the broadcast button/ResultStrip,
      and (b) after steps 2–3 the button and ResultStrip remain fully visible and
      clickable while the toast shows. If the actual covering element turns out
      to be something other than the status toast, inspect it with DevTools,
      identify the exact CSS mechanism (z-index / stacking context / position),
      and fix it at the root using the `--z-layer-*` tokens and the overlay-stack
      conventions (never an ad-hoc `z-[9999]`), then re-verify. Also sanity-check
      the compact aside path.
      Files: whichever file the confirmed root cause lives in (expected:
      `src/components/pages/QrStudioPage.tsx` and/or the panel wrappers above).
      Verify: visual check in the browser — broadcast button and ResultStrip are
      not obscured during and after a broadcast; the toast still appears and
      auto-clears.

- [ ] 5. Full regression pass across the studio and the shared surfaces that must
      not regress.
      Files: none (verification only).
      Verify: `npm test` (`vitest run`) passes; `npm run build` (`tsc && vite build`)
      succeeds. Manually confirm in the dev server that the single-device "Open
      link on device" button, all ResultStrips, the launch confirmation Dialog,
      the ThemedModal, and the other four tabs (Create / Templates / Tools /
      Library) still behave correctly.

## Gaps / assumptions

- The exact pixel height of the status toast is not fixed in code; step 2 uses a
  clearance comfortably larger than one line of toast text (`px-4 py-2` + 11px
  text ≈ 36px, plus `bottom-4` = 16px). The implementer should confirm the final
  value in the browser (step 4) and adjust if the toast wraps to two lines.
- If browser verification shows the overlap does not reproduce with the status
  toast, step 4 explicitly directs the implementer to find and fix the real
  covering element rather than concluding "no fix needed".
