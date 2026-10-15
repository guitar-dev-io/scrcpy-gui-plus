# Verify note — QR Studio "Open on all devices" broadcast button overlap

## The bug (reproduced in a real browser)

In QR Studio → **Device Actions** → "Deep link test" card, the **"Open on all
devices"** broadcast button was getting **covered by the page status toast**.

- **Covering element:** the QR Studio page status toast
  (`role="status" aria-live="polite"` in
  `src/components/pages/QrStudioPage.tsx`). Before the fix it was an **absolute
  overlay** pinned to the bottom-centre of the page root
  (`pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2`), with
  an opaque `<p>` (`bg-[#0d1725]`).
- **Why it won the stacking order / why it covered the button:** the toast is
  `position: absolute` relative to `.qr-studio-root` and is **not** part of the
  scrollable `[role=tabpanel]`. It therefore stays pinned to the bottom-centre of
  the viewport while the panel content scrolls underneath it. Its `z-10` lifts it
  above the base-layer panel content (which sets no `position`/`z-index`), so when
  the Deep link card scrolls into the toast's fixed band, the opaque toast paints
  on top of the broadcast button. This matches the user's report exactly
  ("another element overlaps on top of the button", "เวลากด ปุ่มมันโดนบัง") — a
  broadcast success fires `onStatus('Opened on N of M devices')`, which renders
  the toast directly over the button that was just pressed.
- The toast was `pointer-events-none`, so clicks still passed through; the defect
  was purely visual (the button was hidden), consistent with the complaint.

### Browser evidence (Chrome DevTools MCP + Playwright MCP, Vite dev server)

Measured with `getBoundingClientRect` across every scroll position of the
Device Actions panel at a 1280×720 window (2-column grid, `490px 490px`), only
counting positions where the broadcast button is **actually visible inside the
panel's clip region**:

| Build | Status region | Visible overlaps (button vs toast) |
| --- | --- | --- |
| Baseline (absolute overlay) | `absolute … z-10` | **7** scroll positions (e.g. scrollTop 100/110/120) |
| Fixed (reserved lane) | `flex h-12 shrink-0` (static, below the scroll panel) | **0** |

## Root-cause fix (no ad-hoc z-index)

Rather than mask the overlap with a high `z-index`, the toast was moved **out of
the absolute overlay and into a reserved, non-scrolling flex lane** that follows
the scroll panel inside `.qr-studio-root` (a flex column):

```
- className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
+ className="pointer-events-none flex h-12 shrink-0 items-center justify-center px-4"
```

Because the lane is a `shrink-0` flow sibling **after** the `flex-1`
`overflow-y-auto` tabpanel, the scroll area ends above the lane and the toast can
never paint over scrollable content on **any** tab. The lane keeps a fixed height
(`h-12`) whether or not a message is showing, so a toast appears and auto-clears
with **no layout shift**. Behaviour preserved: bottom-centred placement,
`role="status"`/`aria-live="polite"` announcement, the 2400ms auto-clear timer,
and all five tabs. No `transform`/`filter`/`isolation` added to `.qr-studio-root`,
so the App-level `ThemedModal` (`fixed inset-0 z-[300]`), the launch `Dialog`, and
the portaled `Select` dropdowns are unaffected. The ad-hoc `z-10` was removed (it
is no longer needed — the lane is in normal flow), satisfying the brief's "use the
token system, not ad-hoc z-index" requirement.

### Why not the other suspects (ruled out via DevTools)

- **StudioLayout sticky/fixed top bar** — `QrStudioHeader` is a `shrink-0` flow
  child, not sticky; it sits above the scroll area and never over its bottom.
- **Centered `ThemedModal` (`showAlert`)** — only opens on failure and is centred;
  a successful typed-link broadcast never opens it.
- **Stacking-context inversion on the button** — `ActionButton`/`ResultStrip` set
  no `position`/`z-index`, so sibling cards cannot legitimately paint over them.

### Note on the plan's prescribed fix

The plan proposed reserving bottom padding (`pb-16`) on the panel wrapper. Browser
verification showed this is **insufficient**: the broadcast button is **not** the
last element in the panel (the "Scan with camera" card follows it), so bottom
padding only clears the final element — the button still passed under the fixed
toast band at mid-scroll (overlap still reproduced). The `pb-16` approach was
therefore reverted in favour of the reserved-lane fix above, which removes the
overlap at its root for every scroll position and every tab.

## Screenshots (evidence)

- Before (overlap): `.agents/tasks/broadcast-overlap-before.png` — toast
  "Opened on 2 of 2 devices" painted over the "…all devices" broadcast button.
- `pb-16`-only (overlap persists): `.agents/tasks/broadcast-overlap-ztoken-only-persists.png`.
- After (fixed): `.agents/tasks/broadcast-overlap-after.png` and
  `.agents/tasks/broadcast-overlap-after-button-visible.png` — the toast sits in
  its reserved bottom lane and no longer covers the button (shown on Device
  Actions and on the Tools tab, confirming no cross-tab regression).

## Regression tests added

- `src/components/pages/QrStudioPage.test.tsx` — asserts the status region is a
  non-`absolute`, `shrink-0` flow sibling that follows the scroll panel (locks in
  the reserved-lane structure that prevents the overlay).
- `src/components/qr-studio/DeviceActionsPanel.test.tsx` — asserts the broadcast
  button and its "Last broadcast result" strip stay in the Deep link card and a
  successful broadcast does not remove/replace the button.

## Quality gates (run inside the worktree)

Commands run from `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/qr-broadcast-overlap`:

- `npx tsc --noEmit` (same as the `lint` npm script) → **clean, exit 0**.
- `npx vitest run` (single-run) → **2 failed | 925 passed (927)**.
  - The **only** failures are the 2 PRE-EXISTING, unrelated baseline failures in
    `src/components/ControlPanel/ControlPanel.test.tsx`:
    - `ControlPanel renderer selector › … › shows auto renderer value by default`
    - `ControlPanel renderer selector › … › clears renderDriver when selecting auto renderer`
  - These touch the scrcpy renderer selector, not QR Studio; this change adds **no
    new failures**.
- Scoped `npx vitest run src/components/qr-studio src/components/pages` →
  **209 passed (21 files)**, including the two new regression tests.

## Files changed

- `src/components/pages/QrStudioPage.tsx` — status toast moved to a reserved
  non-scrolling lane (the fix).
- `src/components/pages/QrStudioPage.test.tsx` — regression test + formatter
  normalisation of adjacent lines (project format-on-save hook).
- `src/components/qr-studio/DeviceActionsPanel.test.tsx` — regression test.
