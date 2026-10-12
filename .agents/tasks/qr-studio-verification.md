# QR Studio visual verification (design.md 10.1)

Reviewer: automated Playwright run (Kiro subagent), web build only (`npm run dev:ensure`, http://localhost:1420/#/qr-studio). Not a human review: PASS here means the measurable criteria were observed, not that a person approved the look.

Method notes
- Viewports were set with `setViewportSize`. 80/125/150% zoom is EMULATED by shrinking/growing the CSS viewport (1920/z x 1080/z: 2400x1350, 1536x864, 1280x720). Real browser zoom was not used.
- `scrollWidth <= clientWidth` was read from `document.documentElement` for every shot (all equal: no horizontal overflow).
- The empty Library was seeded with 14 sample v1 records through localStorage to exercise menu, drawer and confirm scenes (they migrated to v2; 3 were then trashed during testing).
- Web build has no Tauri `invoke`: Rust-backed features are unavailable here. See finding F2.
- Primary-action-visible check on Create: Save button bottom edge at y=735 of 768 at 1366x768 (visible without page scroll).

## Destinations at 100% (25 files, `<vp>-100-<dest>.png`)

| Viewport | create | templates | device-actions | tools | library |
|---|---|---|---|---|---|
| 1920x1080 | PASS (1920/1920) | PASS | PASS | PASS | PASS |
| 1536x864 | PASS (1536/1536) | PASS | PASS | PASS | PASS |
| 1366x768 | PASS (1366/1366) | PASS | PASS | PASS | PASS |
| 1280x720 | PASS (1280/1280) | PASS | PASS | PASS | PASS |
| 1024x768 | PASS (1024/1024) | PASS | PASS | PASS | PASS |

Caveat: the no-overflow numeric criterion was measured for all 25. Only 1920x1080-library and 1366x768-create were visually inspected by me; the others were not individually eyeballed. Heading contrast (F1) applies to all of them, so a human should treat these rows as "layout PASS, contrast FAIL, see F1".

## Zoom (emulated)

| Scene | Result |
|---|---|
| 1920x1080-80-create | PASS (2400/2400) |
| 1920x1080-80-library | PASS (2400/2400) |
| 1920x1080-125-create | PASS (1536/1536) |
| 1920x1080-125-library | PASS (1536/1536) |
| 1920x1080-150-create | PASS (1280/1280) |
| 1920x1080-150-library | PASS (1280/1280); Drawer vs column not separately confirmed at this width |

## Overlays

| Scene | Result | Evidence |
|---|---|---|
| 1280x720-100-confirm | PASS | Empty Trash alertdialog rect 430,259-850,461 inside 1280x720; buttons bottom 448; Cancel focused; scroll 1280/1280 |
| 1280x720-150-confirm | PASS | emulated 853x480; dialog 217,139-637,341; buttons bottom 328; Cancel focused; 853/853. Long-content body scroll NOT exercised |
| 1366x768-100-menu-flip | PASS | Button y=603-635; menu 275-599 (opens upward), 160x324, fully visible; 1366/1366 |
| 1366x768-100-menu-over-footer | NOT RUN | The flipped menu did not reach the footer/tab bar region; no file produced |
| 1366x768-100-tooltip-edge | NOT RUN | No right-edge tooltip trigger located/exercised |
| 1280x720-100-dialog-over-drawer | PASS | Drawer open (z 1210/1200), confirm alertdialog above it (z 1310/1300), Cancel focused; after Escape focus returned to the "Delete forever" opener and the drawer stayed open |

## Findings (not fixed; outside "layout bug" scope)

- F1 (FAIL, contrast): in the light `ultraviolet` theme, panel headings ("Create QR Code", "Live Preview", "Library", "Details", "Folders") render with theme-dark text (rgb 28,25,23) on QR Studio's hard-coded navy panels, so they are nearly invisible. Cause: shared `SectionHeader` uses `--text-base`; QR panels use fixed navy backgrounds. Not checked in dark themes.
- F2 (web-only): Create live preview shows the raw error "Preview failed: Cannot read properties of undefined (reading 'invoke')" next to "Requires the desktop app", instead of only the friendly message.
- F3: at 1366x768 the header's Saved/Links/device selector wrap onto a second row below the tabs (no overflow, but the header is taller than at 1536+).
- Delete from a card menu moves to Trash without a dialog by design (confirm only for bulk > threshold, Delete forever, Empty Trash).
