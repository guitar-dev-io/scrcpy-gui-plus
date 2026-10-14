# Implementation Plan — Device Wall three-dot menu portal fix

## Context (grounded in the worktree)

- Bug: In `src/components/device-wall/DeviceWallCard.tsx` the three-dot "More actions" menu is a native `<details ref={menuRef} className="relative shrink-0">` whose dropdown is a `position: absolute` `<div>` (`absolute right-0 top-[calc(100%+4px)] z-30 w-40 ...`) rendered INSIDE the card `<article className="group relative flex flex-col overflow-hidden ...">`. The card has `overflow-hidden` and sits in a grid of sibling cards each with a live preview; a `z-30` inside the card's stacking context cannot escape the card's `overflow-hidden`/transform ancestors, so the open menu is clipped by the card and painted under adjacent cards / the next device preview.
- Correct fix (reuse existing infra, do NOT hand-roll z-index): replace the `<details>` + absolute div with the shared portaled `Menu` component at `src/components/ui/overlay/Menu.tsx`, exported as `Menu` from `src/components/ui/index.ts` with types `MenuItem`, `MenuProps`. `Menu` portals into `#qr-overlay-root` (a `body > #qr-overlay-root` sibling of `#root`, created by `getOverlayHost()` in `src/components/ui/overlay/overlayHost.ts`), paints at `zIndex: 'var(--z-layer-dropdown)'`, and registers via `useOverlayEntry({ kind: 'menu', ... })` for outside-click close, Escape close, focus management, and anchored floating position. This is the exact pattern every other overlay in the project uses.

### Verified facts about the shared `Menu` API (read from `Menu.tsx` + `Menu.test.tsx`)

- `MenuProps`: `{ items: MenuItem[]; trigger: ReactNode; triggerLabel: string; triggerClassName?: string; placement?: Placement; disabled?: boolean }`.
- `Menu` owns its own open state (internal `useState`) and renders its own `<button>` trigger (`aria-haspopup="menu"`, `aria-expanded`, `aria-label={triggerLabel}`). So the old `menuRef`/`<summary>`/`<details open>` mechanics are REPLACED, not re-wired — there is no need for `useState` in the card.
- `MenuItem`: `{ id: string; label: ReactNode; textValue?: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; checked?: boolean; danger?: boolean; separatorBefore?: boolean }`.
- `runMenuAction` semantics (close-then-run) are already built into `Menu`: `MenuList.activate()` calls `onClose({ focusTrigger: true })` BEFORE `item.onSelect()`. So each old `runMenuAction(handler)` becomes simply `onSelect: handler`. The explicit `runMenuAction` wrapper and `menuRef` are deleted.
- The red "Reboot" styling maps to `danger: true` (the item renders `text-red-400`). The divider maps to `separatorBefore: true` on the Reboot item.
- `placement="bottom-end"` right-aligns the panel to the trigger, matching the old `right-0` visual position (default is `bottom-start`).
- Disabled gating `disabled={!available}` maps to `disabled: !available` per item. The conditional "Setup ADB" item (`registeredDevice?.agent?.connected && !available && onSetupAdb`) is included conditionally by building the `items` array conditionally.
- Trigger content was `<MoreHorizontal size={14} />`; keep it as `trigger`. `triggerLabel` = `` `More actions for ${model}` ``.
- Keep the old trigger button look by passing `triggerClassName` equal to the old `<summary>` classes (minus the `[&::-webkit-details-marker]:hidden` which no longer applies to a `<button>`): `"flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]"`.

### Verified build/test facts

- `package.json`: `lint` = `tsc --noEmit`, `test` = `vitest run`, `dev` = `vite dev`. Test env: vitest + jsdom, `setupFiles: ./src/test/setup.ts` (see `vite.config.ts` `test` block).
- Baseline (captured at planning time): `npx tsc --noEmit` exits 0 (clean). `npx vitest run` → `Test Files 1 failed | 156 passed`, `Tests 2 failed | 923 passed`. The ONLY 2 failures are in `src/components/ControlPanel/ControlPanel.test.tsx` (renderer Select "Auto" ambiguity) — pre-existing and unrelated. The change must add NO new failures; these 2 remaining is acceptable.
- `DeviceWallCard` is rendered by `src/components/pages/DeviceWallPage.tsx` (line ~419). An existing `src/components/pages/DeviceWallPage.test.tsx` already renders two cards side by side with tauri core mocked (`vi.mock('@tauri-apps/api/core')`), `@tauri-apps/plugin-dialog` mocked, and a `StubIntersectionObserver` global — this is the exact harness pattern to reuse for the portal regression test.
- Overlay test helper `mockLayout()` lives in `src/components/ui/overlay/testUtils.ts` (stubs `getBoundingClientRect` + `ResizeObserver`), used by `Menu.test.tsx`.

## Design decision

Use the shared `Menu` component directly (not the lower-level `useOverlayEntry` + `createPortal` pattern). Rationale: the card menu is a plain trigger-anchored action menu — exactly `Menu`'s use case. Its props cover every requirement (trigger content/label/class, per-item disabled, danger, separator, bottom-end placement, close-then-run). Dropping to the lower-level pattern would re-implement focus/keyboard/outside-click logic that `Menu` already provides and that `Menu.test.tsx` already guards. No API gap exists, so the lower-level fallback is unnecessary.

---

# Implementation Plan

- [ ] 1. Refactor the DeviceWallCard three-dot menu to use the shared portaled `Menu`.
      Read the FULL `src/components/device-wall/DeviceWallCard.tsx` (~290 lines) first to capture every prop, handler, icon, class, and the exact item order. Replace the entire `<details ref={menuRef} ...> ... </details>` block (the trigger `<summary>` + the `absolute ... z-30` dropdown div) with `<Menu .../>` from `../ui` (`import { Menu } from '../ui'`, type `import type { MenuItem } from '../ui'`). Delete `menuRef` (`useRef<HTMLDetailsElement>`) and the `runMenuAction` wrapper (close-then-run is built into `Menu.activate`). Build the `items: MenuItem[]` array in this exact order, preserving every behavior:
        1. `{ id: 'live', label: 'Open Live Control', icon: <MonitorPlay size={12} />, onSelect: onOpenLiveControl, disabled: !available }`
        2. `{ id: 'screenshot', label: 'Screenshot', icon: <Camera size={12} />, onSelect: onScreenshot, disabled: !available }`
        3. `{ id: 'shell', label: 'ADB Shell', icon: <Shell size={12} />, onSelect: onOpenShell, disabled: !available }`
        4. `{ id: 'info', label: 'Device Info', icon: <Info size={12} />, onSelect: onOpenInfo, disabled: !available }`
        5. Conditionally, only when `registeredDevice?.agent?.connected && !available && onSetupAdb`: `{ id: 'setup-adb', label: 'Setup ADB', icon: <Plug size={12} />, onSelect: onSetupAdb }` (no `disabled`).
        6. `{ id: 'reboot', label: 'Reboot', icon: <RotateCcw size={12} />, onSelect: onReboot, disabled: !available, danger: true, separatorBefore: true }` (the `separatorBefore` reproduces the old divider; `danger` reproduces the red styling).
      Render `<Menu items={items} trigger={<MoreHorizontal size={14} />} triggerLabel={`More actions for ${model}`} triggerClassName="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]" placement="bottom-end" />`. Wrap `<Menu>` so it keeps its grid slot: put it in `<div className="shrink-0">` (the old `<details>` carried `relative shrink-0`; `relative` is no longer needed since the panel is portaled). Remove now-unused imports if any become unused; keep all icon imports that are still referenced. Do NOT change anything else in the card (checkbox button, status badge, preview, capability dots, wifi/usb icon).
      Files: `src/components/device-wall/DeviceWallCard.tsx`
      Verify: `npx tsc --noEmit` exits 0 with no errors; `npx vitest run src/components/pages/DeviceWallPage.test.tsx` passes (the existing page tests still render cards and are unaffected).

- [ ] 2. Add a focused regression test asserting the Device Wall menu portals to `#qr-overlay-root`.
      Create `src/components/device-wall/DeviceWallCard.test.tsx`. Mirror `src/components/ui/overlay/Menu.test.tsx` (use `mockLayout()` from `../ui/overlay/testUtils` in `beforeEach`/`afterEach`) and the harness from `src/components/pages/DeviceWallPage.test.tsx` (stub `IntersectionObserver`; the card uses it via `useInView`). Render a single `<DeviceWallCard>` directly with a minimal `RegisteredDevice` (`adbState: 'device'`, `connectionType: 'usb'`, `health: { success: true, serial, model: 'Pixel 8' }`) and no-op handlers for all required callbacks (`onToggleSelect`, `onFocus`, `onOpenLiveControl`, `onScreenshot`, `onReboot`, `onOpenShell`, `onOpenInfo`), `running={false}`, `fps`/`startDelayMs`/`density`/`selected`/`focused` set to simple values. Note the card calls `useDevicePreview`/`useDeviceRecoverySnapshot`; if those reach tauri `invoke`, mock `@tauri-apps/api/core` with `vi.hoisted` exactly as `DeviceWallPage.test.tsx` does. Assertions:
        (a) click the trigger `screen.getByRole('button', { name: 'More actions for Pixel 8' })`; the opened `screen.getByRole('menu')` is contained by `document.getElementById('qr-overlay-root')` (`expect(document.getElementById('qr-overlay-root')).toContainElement(menu)`), proving it is NOT inside the card `<article>`;
        (b) `expect(menu.style.zIndex).toBe('var(--z-layer-dropdown)')`;
        (c) all six (or five when Setup ADB absent) expected `menuitem`s are present with correct labels and that disabled items carry `aria-disabled` when `available` is false — render one case with `available` true (device connected) to see enabled items and the absence of Setup ADB.
      Files: `src/components/device-wall/DeviceWallCard.test.tsx`
      Verify: `npx vitest run src/components/device-wall/DeviceWallCard.test.tsx` — all new tests pass.

- [ ] 3. Produce browser-based before/after visual evidence of the overlap fix.
      Start the dev server in the BACKGROUND, never blocking: `vite dev` (run_in_background) from the worktree root; wait for the printed local URL (default `http://localhost:1420`, `strictPort: true` per `vite.config.ts`). Drive a headless browser (Chrome DevTools MCP or Playwright MCP) to the Device Wall page, preferring at least two cards side by side. If the full app cannot boot headlessly with cards present, mount `DeviceWallCard` in a focused harness in the style of `src/components/ui/overlay/Menu.test.tsx`/`DeviceWallPage.test.tsx` and screenshot that. Capture: a BEFORE shot is not reproducible after the code change, so instead capture an AFTER shot of the open menu clearly painting ABOVE the neighboring card/preview, plus a DOM check. Save screenshots into `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/devicewall-menu/.agents/tasks/` (e.g. `device-wall-menu-after.png`). Confirm in the live DOM that the open menu element lives under `#qr-overlay-root` (not inside the card `<article>`). Stop the background dev server when done.
      Files: `.agents/tasks/device-wall-menu-after.png` (and any additional evidence shots)
      Verify: the saved screenshot shows the open menu fully visible over the adjacent card/preview; the DOM inspection confirms the `role="menu"` node is a descendant of `#qr-overlay-root`.

- [ ] 4. Run the full quality gates and record the evidence note.
      From the worktree root run `npx tsc --noEmit` (the `lint` script) and `npx vitest run` (single-run, NEVER watch). Confirm `tsc` exits 0 and that the ONLY failing tests are the 2 pre-existing `ControlPanel.test.tsx` failures (no NEW failures; new `DeviceWallCard.test.tsx` and existing `DeviceWallPage.test.tsx` pass). Record exactly what was run and the results — command lines, tsc exit status, vitest pass/fail counts, and explicit confirmation the 2 remaining failures are the known pre-existing ControlPanel ones — into `/Users/anuwat.t/scrcpy-gui-plus/.worktrees/devicewall-menu/.agents/tasks/device-wall-verify-note.md` so the reviewer can read the evidence without re-running the suites. Clean up any temporary harness/screenshot scaffolding not meant to be committed (keep the evidence screenshots and the note).
      Files: `.agents/tasks/device-wall-verify-note.md`
      Verify: `npx tsc --noEmit` exits 0; `npx vitest run` shows `2 failed` (both ControlPanel) with the new/existing device-wall tests green; the note file records these results.

## Notes / assumptions

- Assumption: `Menu`'s `separatorBefore` on the Reboot item + `danger: true` fully reproduce the old `border-t` divider and red Reboot styling; the exact font-size/padding of items will differ slightly (shared `Menu` uses `--font-size-body-sm` and `px-3 py-2` vs the card's `text-[9px] px-2 py-1.5`). This is an intentional, acceptable visual normalization toward the shared component — the task mandates reusing the shared `Menu`, and consistency with every other overlay is the goal. If pixel-identical item sizing is later required, it would be a follow-up; it is not part of fixing the overlap root cause.
- The task's requirement to re-implement open state with `useState` applies only IF `Menu`'s API didn't fit; it does fit, and `Menu` manages open state internally, so no card-level `useState` is introduced. This is the simpler, correct wiring.
- Loop stop contract is unchanged: the implement-and-review loop writes its verdict to `.agents/tasks/device-wall-review.json` and stops when `verdict` == `APPROVED`. This plan file is the input to that loop.
