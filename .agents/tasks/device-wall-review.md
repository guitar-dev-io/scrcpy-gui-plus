# Device Wall three-dot menu portaled above neighboring cards

The Device Wall card's "More actions" dropdown was a native `<details>` holding a `position:absolute z-30` panel inside the card's `overflow-hidden` stacking context, so it was clipped by the card and painted under neighboring cards. The fix replaces that in-card dropdown with the project's shared portaled `Menu` component, which renders the open list into `#qr-overlay-root` (a direct child of `<body>`) at `z-index: var(--z-layer-dropdown)`. This is a root-cause fix: the menu now escapes the card's overflow/stacking context entirely rather than relying on a bumped z-index on an in-card element. All five menu items, their gating, ordering, red Reboot styling, divider, trigger aria-label, and keyboard/outside-click/Escape behavior are preserved by mapping onto the `Menu`'s `MenuItem` contract.

Watch for: menu item typography/padding changes from the card's `text-[9px] px-2 py-1.5` to the shared `--font-size-body-sm` / `px-3 py-2` (confirmed; cosmetic, inherent to adopting the shared component, no behavior change). No functional or behavioral regressions found.

**Verdict**: APPROVED

## High-level view

The dropdown is no longer owned by the card. The old `<details ref={menuRef}>` plus absolute-positioned `z-30` div is gone, replaced by a single `<Menu>` that portals its open list into `#qr-overlay-root` via `createPortal(..., useLayerHost())`, which falls back to `getOverlayHost()` outside any surface. The list carries `zIndex: var(--z-layer-dropdown)` and `position: fixed`, so it paints above sibling cards and the device preview and is never clipped. This is the mandated root-cause fix, not an arbitrary high z-index on an in-card node.

Behavior is preserved by data, not markup. The five items (Open Live Control, Screenshot, ADB Shell, Device Info, Reboot) are built as a `MenuItem[]` in the same order, each still gated by `disabled: !available`. The conditional Setup ADB item appears under exactly the original predicate (`registeredDevice?.agent?.connected && !available && onSetupAdb`) and is the one item that stays enabled in that offline-with-agent state. Reboot keeps its red styling via `danger: true` and the divider via `separatorBefore: true`. The trigger keeps `aria-label={`More actions for ${model}`}` and right-alignment via `placement="bottom-end"`.

The close-then-run ordering that the old `runMenuAction` provided is now built into the shared component: `Menu.activate` calls `onClose({ focusTrigger: true })` before `item.onSelect()`, so the menu closes and returns focus to the trigger before the action runs — the same observable order as before. Outside-click/Escape close and focus restoration come from the shared `useOverlayEntry` wiring rather than hand-rolled `<details>` behavior.

A new focused test asserts the DOM-containment property that proves the fix: the open `role="menu"` is contained by `#qr-overlay-root` and not by the card `<article>`, and its inline `zIndex` is `var(--z-layer-dropdown)`. Four more tests cover the enabled item set (no Setup ADB when connected), the offline/agent state (ADB actions disabled, Setup ADB enabled), select-runs-and-closes with focus return, and Escape-closes with focus return.

<details>
<summary>Issues (1)</summary>

1. **Menu item typography shift** — items move from `text-[9px] px-2 py-1.5` to the shared `--font-size-body-sm` / `px-3 py-2`. Inherent to adopting the shared overlay component (the mandated fix) and consistent with every other overlay in the app; no action required, noted for awareness.

</details>

<details>
<summary>Details</summary>

### Root-cause fix: portaled overlay replaces the in-card dropdown

The old markup nested the menu panel inside the card: `<details ref={menuRef}>` with a `<div className="absolute right-0 top-[calc(100%+4px)] z-30 ...">`. Because the card `<article>` establishes an overflow/stacking context, that panel was clipped and ordered below adjacent cards no matter how high the z-index. The replacement renders nothing extra inside the card beyond the trigger button; the open list is produced by `Menu`'s `MenuList` through `createPortal(node, host)` where `host = useLayerHost()`. `useLayerHost` returns the enclosing surface's layer host or, outside any Dialog/Drawer (the Device Wall case), falls back to `getOverlayHost()`, which lazily creates `body > #qr-overlay-root`. The list node sets `position: fixed` with computed coordinates and `zIndex: var(--z-layer-dropdown)`, so it is positioned relative to the viewport and painted on the shared dropdown layer, outside every card's overflow and stacking context.

A grep of `DeviceWallCard.tsx` for `details`, `menuRef`, `runMenuAction`, `absolute right-0`, `z-30`, and `useRef` returns no matches — the old pattern is fully removed, not left behind as dead code. The unused `useRef` import was dropped and `MoreHorizontal` is now the trigger content.

### Behavior preserved through the MenuItem contract

The items array reproduces the original set and order one-to-one. Open Live Control, Screenshot, ADB Shell, and Device Info each carry `disabled: !available`. Setup ADB is spread in conditionally under the exact original predicate `registeredDevice?.agent?.connected && !available && onSetupAdb` and is the only item without a `disabled` flag, matching the old markup where it was the lone always-enabled action in that state. Reboot is last with `disabled: !available`, `danger: true` (red text, verified in `Menu.tsx` via `item.danger ? 'text-red-400'`), and `separatorBefore: true`, which renders the `role="separator"` divider the old `<div className="my-1 border-t">` provided.

Close-then-run is now intrinsic. `Menu.activate` short-circuits on `item.disabled`, then calls `onClose({ focusTrigger: true })` before `item.onSelect()`. The comment in the component notes this ordering is deliberate so that a Dialog opened by `onSelect` captures the trigger as its opener — the same close-first ordering the old `runMenuAction` guaranteed by removing the `open` attribute before invoking the action. Outside-click, Escape, and anchor-hidden close paths all flow through `useOverlayEntry` / `useFloatingPosition`, so the hand-rolled `<details>` toggle is no longer needed.

The trigger keeps `aria-label={`More actions for ${model}`}` (passed as `triggerLabel`, applied to the `<button aria-label>`), the original summary classes via `triggerClassName`, and right alignment via `placement="bottom-end"`. The wrapping `<div className="shrink-0">` keeps the trigger's slot in the card footer flex row, so no layout regression to the rest of the card.

### Test coverage

The new `DeviceWallCard.test.tsx` uses the shared `mockLayout()` seam (same as `Menu.test.tsx`) plus the `DeviceWallPage` harness conventions (`@tauri-apps/api/core` mocked through `vi.hoisted`, `IntersectionObserver` stubbed). The portal test is the one that matters for this fix: after opening, it asserts `#qr-overlay-root` contains the `role="menu"` node, the card `<article>` does not, and `menu.style.zIndex === 'var(--z-layer-dropdown)'` — direct DOM proof the menu escaped the card. The remaining tests assert the connected item set excludes Setup ADB, the offline/connected-agent state disables ADB actions while leaving Setup ADB enabled, selecting an item runs its handler once and closes the menu with focus back on the trigger, and Escape closes with focus restored.

Not tested: the OnePlus/Galaxy neighbor-card overlap visually (covered by the saved screenshot instead), and the typeahead/arrow-key navigation of the shared Menu (already covered by `Menu.test.tsx`, out of scope here).

### Visual evidence

`device-wall-menu-after.png` shows three real cards side by side with the Pixel 8 menu open. The list extends well below the first card's bottom edge, floating over the empty layout area — behavior the old clipped `absolute z-30` panel could not produce. All five items render with icons, the divider separates Device Info from Reboot, and Reboot is red. This corroborates the DOM-containment assertions in the test and the live-DOM MCP check recorded in the verify note (`inOverlayRoot: true, insideCard: false, zIndex: "var(--z-layer-dropdown)"`).

### Quality gates (from the coder's verify note)

The coder recorded running `npx tsc --noEmit` (exit 0, the `lint` script), the focused `DeviceWallCard.test.tsx` + `DeviceWallPage.test.tsx` run (8 passed), and the full `npx vitest run` (157 files passed / 1 failed; 928 tests passed / 2 failed). The only two failures are the pre-existing, unrelated `ControlPanel.test.tsx` renderer-selector "Auto" ambiguity cases, which are the allowed known failures. Passing count rose by 5 (the new DeviceWallCard tests) with no new failures. Per instructions I did not re-run the suites; the recorded evidence is specific, internally consistent, and matches the code I read, so no spot-check was warranted.

</details>

<details>
<summary>File map</summary>

- `src/components/device-wall/DeviceWallCard.tsx` — replaced `<details>`/`absolute z-30` dropdown with the shared `Menu`; items built as `MenuItem[]`; dropped `menuRef`/`runMenuAction`/unused `useRef`.
- `src/components/device-wall/DeviceWallCard.test.tsx` (new) — portal/z-layer DOM proof plus item-set, gating, select-close, and Escape-close regression tests.

Full diff: `git -C /Users/anuwat.t/scrcpy-gui-plus/.worktrees/devicewall-menu diff main -- src/components/device-wall/DeviceWallCard.tsx src/components/device-wall/DeviceWallCard.test.tsx`

</details>
