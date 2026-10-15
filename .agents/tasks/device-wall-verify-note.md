# Device Wall three-dot menu overlap — verification note

## What changed

- `src/components/device-wall/DeviceWallCard.tsx`: replaced the native
  `<details ref={menuRef} className="relative shrink-0">` + `position:absolute`
  `z-30` dropdown `<div>` (clipped by the card's `overflow-hidden`/stacking
  context) with the shared portaled `Menu` component (`../ui`). The menu now
  portals into `#qr-overlay-root` at `zIndex: var(--z-layer-dropdown)`, so it
  paints above sibling cards and the device preview and is never clipped.
  - Deleted `menuRef` (`useRef<HTMLDetailsElement>`) and the `runMenuAction`
    close-then-run wrapper — close-then-run is built into `Menu.activate`
    (`onClose({ focusTrigger: true })` runs before `item.onSelect()`).
  - Items preserved in the same order with the same gating:
    Open Live Control / Screenshot / ADB Shell / Device Info (each
    `disabled: !available`), conditional Setup ADB (only when
    `registeredDevice?.agent?.connected && !available && onSetupAdb`), then
    Reboot (`disabled: !available`, `danger: true`, `separatorBefore: true` —
    reproduces the red styling + divider).
  - Trigger: `<MoreHorizontal size={14} />`, `triggerLabel={`More actions for
    ${model}`}`, old summary classes passed via `triggerClassName`,
    `placement="bottom-end"` to keep the old right-aligned position. Wrapped in
    `<div className="shrink-0">` to keep its grid slot.
- `src/components/device-wall/DeviceWallCard.test.tsx` (new): regression test
  mirroring `Menu.test.tsx` (`mockLayout()`) + the `DeviceWallPage.test.tsx`
  harness (`@tauri-apps/api/core` mocked via `vi.hoisted`, `IntersectionObserver`
  stubbed). Asserts: the opened menu is contained by `#qr-overlay-root` and NOT
  by the card `<article>`; `menu.style.zIndex === 'var(--z-layer-dropdown)'`;
  the enabled item set with no Setup ADB when connected; disabled ADB actions +
  enabled Setup ADB when offline with a connected agent; select runs the handler
  and closes; Escape closes and restores trigger focus.

## Commands run (from the worktree root)

Worktree: `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/devicewall-menu`

1. `npx tsc --noEmit`  (this is the `lint` script)
   → exit 0, no errors.

2. `npx vitest run src/components/device-wall/DeviceWallCard.test.tsx src/components/pages/DeviceWallPage.test.tsx`
   → `Test Files 2 passed (2)`, `Tests 8 passed (8)`.

3. `npx vitest run`  (full suite, single-run)
   → `Test Files  1 failed | 157 passed (158)`
   → `Tests  2 failed | 928 passed (930)`
   → The ONLY 2 failures are the PRE-EXISTING, unrelated ControlPanel ones:
     - `ControlPanel.test.tsx > renderer selector > with supported renderers
       and default config > shows auto renderer value by default`
     - `ControlPanel.test.tsx > renderer selector > when selecting renderers >
       clears renderDriver when selecting auto renderer`
     Both fail on `screen.getByText('Auto')` matching multiple elements —
     renderer Select "Auto" ambiguity, nothing to do with this change.
   → Baseline (per plan) was `2 failed | 923 passed`; passing count rose by 5
     (the new DeviceWallCard tests). No NEW failures introduced.

## Browser-based visual + DOM evidence

- The app is a Tauri app and port 1420 was already held by the user's MAIN
  checkout dev server (`scripts/ensure-vite.mjs`, cwd `/Users/anuwat.t/scrcpy-gui-plus`),
  which was left untouched. Per the plan's fallback, a focused harness
  (temporary `harness.html` + `src/harness-devicewall.tsx`, since removed)
  mounted three real `DeviceWallCard`s side by side, served by the worktree's
  own `vite dev` on port 1430, with the Tauri runtime stubbed.
- Screenshot (saved): `.agents/tasks/device-wall-menu-after.png` — the Pixel 8
  three-dot menu opens and renders fully (all items incl. red Reboot + divider)
  overflowing past the card's bottom edge and floating above the layout, which
  the old `overflow-hidden` + `absolute z-30` dropdown could not do.
- Live DOM check (Chrome DevTools MCP and Playwright MCP, menu open):
  `{ menuExists: true, inOverlayRoot: true, insideCard: false,
     zIndex: "var(--z-layer-dropdown)", overlayIsBodyChild: true }`
  → the `role="menu"` node is a descendant of `#qr-overlay-root` (a direct
  child of `<body>`), NOT inside the card `<article>`, proving it escaped the
  card's overflow/stacking context. Confirmed open/select/Escape behavior and
  the trigger's `aria-label` / `aria-expanded`.

## Notes

- Item font-size/padding normalize to the shared `Menu` styling
  (`--font-size-body-sm`, `px-3 py-2`) vs the card's old `text-[9px] px-2 py-1.5`.
  This is the intended consequence of reusing the shared overlay component (the
  mandated fix) and is consistent with every other overlay in the app; it does
  not change behavior.
- Temporary harness scaffolding (`harness.html`, `src/harness-devicewall.tsx`)
  and the worktree dev server were removed/stopped after capturing evidence.
  The user's main dev server on 1420 was not touched.
