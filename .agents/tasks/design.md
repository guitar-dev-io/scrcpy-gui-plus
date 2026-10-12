# QR Studio Refactor: Technical Design

## 0. Overview, scope, and caveats

This is an in-place refactor of the existing QR Studio module (`QrStudioPage.tsx`, 672 lines, single page, Create + Library). The module is split into a 5-destination workspace, the data model is versioned and extended, and a shared overlay layer is introduced that the rest of the app can adopt incrementally. Nothing is rewritten from scratch: `generate_qr_svg`, `styleQrSvg`, `parseMultiQrInput`, `qrFileName`, `loadQrRecords`, the colour/contrast helper, PNG/SVG download code, and the dark navy + coral (`#ff4f57`) look are kept and moved into the new structure.

Authoritative current state is `.agents/tasks/qr-studio-checklist.md` (2 DONE / 7 PARTIAL / 10 NOT DONE). Facts verified in code while writing this design:

- No `createPortal` is used anywhere in `src`. The `AppShell` renders `<div id="app-overlays">{children}</div>` outside `<main>` but inside the animated shell root; it is NOT used as the portal host (see 8.4). The portal host is `body > #qr-overlay-root`.
- `AppShell` root has an inline `opacity:0` plus a `fadeIn ... forwards` animation, so it is one stacking context. `<main>` is `overflow-y-auto`. This is the root cause of clipped card menus (absolute inside `overflow` ancestors), not just a low z-index.
- z-index today: `--z-sidebar:30, --z-topbar:40, --z-drawer:80, --z-modal:300` in `src/index.css`, plus ~20 ad-hoc literals (`z-[100]`, `z-[120]`, `z-[200]`, `z-[300]`, `z-[380..400]`, `z-[500]`, `z-[999]`). `ThemedModal` is `fixed z-[300]`, not portaled, no focus trap. `Tooltip.tsx` is `absolute z-[100]`, not viewport-clamped.
- `App.tsx` lines 1987, 2002, 2005 hide `AppNavigation`, `Footer` and `WorkspaceTabBar` for `qr-studio`. `AppNavigation.tsx` already has a `qr-studio` icon entry.
- Rust already provides `launch_deep_link` (`am start -a VIEW -d`, validated serial/URI), `generate_qr_svg`, `capture_screenshot`, `capture_png_frame` (`pub(crate)`, `adb exec-out screencap -p`), `push_file` (adb push to `/sdcard/Download/`), `device_action`, `adb_shell`. `Cargo.toml` already has `image` (png, jpeg), `base64`, `qrcode`.
- No QR decoder exists in npm or Cargo. No Floating UI / Radix. The only Tauri plugin is dialog (no fs plugin).
- `vitest` environment is jsdom.

Caveat A (reference image): the reference image `refs/Screenshot 2569-09-27 at 13.05.09.png` was viewed (downscaled copy). It is a screenshot of a third-party desktop device manager ("PandaClassic 5.0.0.0"): a mirrored phone window beside a manager window with a top link strip, a row of action tabs (Mirror setting, Quick actions, Adb shell, Adb, Script, Add Remote), a grid of equally sized action buttons, a "Manage Group" block with a folder-like dropdown (All (1)) plus add/remove/edit icons, a search field, "Show type" filter checkboxes (All/USB/Wireless), a device row with checkbox, a device preview card on the right, a tooltip over a toolbar icon, and a full-width status bar. It is NOT a QR Studio mock-up and uses blue on neutral grey, not navy and coral. Decision: take structural ideas only (header strip with tabs, folder dropdown with add/remove/edit icons, search + type filter row, checkbox rows, preview card, bottom status line for counts, tooltips on icon buttons) and keep the existing dark navy and coral `#ff4f57` palette that the checklist records and the brief names. Final screenshots are compared against it for structure, not colour.

Caveat B: nothing here has been run. All statements about existing code are from reading it; statements about new behaviour are design intent.

### Scope summary

| Requirement | Status |
|---|---|
| 1 Navigation + shell preserved | In scope |
| 2 Library (search/filter/sort/view/select/bulk/folders/tags/trash/details) | In scope |
| 3 Data model v2 + safe migration | In scope. Migration is non-destructive (no destructive migration needed) |
| 4 Templates | In scope |
| 5 Create | In scope |
| 6 Device Actions | Open on Device: in scope (existing command). Send to Device: in scope (one new small Tauri command, honest). Capture & Decode: in scope (one new command + decoder). Scan with camera: always disabled with explanation |
| 7 Tools | In scope (decoder needs one new Rust dependency, flagged) |
| 8 Overlay architecture | In scope, and the highest-risk part |
| 9 Responsive | In scope |

Flags for the user (decisions that carry cost):
1. New Cargo dependency `rqrr = { version = "=0.11.0", default-features = false }` for decoding (requires Rust >= 1.85.1) (section 7.3). This is the only new dependency anywhere. No npm dependency is added.
2. Three new Tauri commands: `qr_send_to_device`, `qr_capture_and_decode`, `qr_decode_image`, all in the new file `src-tauri/src/qr_device.rs`. Backend changes require a Rust rebuild.
3. Overlay primitives are hand-written (no Floating UI). Reasoning in 8.3.
4. Removing the App.tsx special-casing changes the QR route chrome: it will now show the sidebar, tab bar and footer like other routes. This is required by the brief.
5. Security fix to an existing command: `launch_deep_link` gets POSIX single-quoting (6.0). It changes shared behaviour for the existing Deep Link screens (URIs containing `&` start working instead of being truncated).
6. Nothing needs a destructive migration. Nothing is a genuine blocker, except that live camera scanning is impossible to do truthfully from a desktop app driving ADB (see 6.4).

Technology stack (locked on approval): React 19, TypeScript 6, Vite 8, Vitest 4 + Testing Library (jsdom), Tailwind 4 utility classes + CSS variables in `src/index.css`, lucide-react icons, Tauri 2 / Rust (`qrcode`, `image`, `base64`, new `rqrr =0.11.0` with default features off). No state library; React state + hooks + localStorage.

## 1. Navigation and shell

### 1.1 Shell special-casing removal

In `src/App.tsx` remove the three conditionals so the same props are passed for every route:

- `navigation={<AppNavigation .../>}` (drop `activeRoute === 'qr-studio' ? undefined :`)
- `footer={<Footer version={appVersion} />}`
- `{<WorkspaceTabBar ... />}` (drop `activeRoute !== 'qr-studio' &&`)

`QrStudioPage` currently renders its own "back to Dashboard" button (`onExit`). Keep the `onExit` prop for API compatibility but remove the button from the header because the shell sidebar now provides navigation. The existing test "back to dashboard" in `QrStudioPage.test.tsx` is rewritten to assert the page no longer renders a Dashboard button (it is replaced by shell navigation). The three sites above (`App.tsx` lines 1987, 2002, 2005) are the complete list of `qr-studio` conditionals in `App.tsx`; the route is also mapped in `OtherPages.tsx:63` (unchanged) and listed in `src/navigation/appRoutes.test.ts` (unchanged; the route id list stays valid). Before editing, the implementer reads `appRoutes.test.ts`, `QrStudioPage.test.tsx` and runs `grep -rn "qr-studio" src` (not a glob-based include, which fails under zsh) to confirm no other hide-assumption. Other routes are untouched since only the `qr-studio` branches are deleted.

Required test (mandatory, not conditional): extract `shellChromeForRoute(route: AppRoute): { navigation: boolean; footer: boolean; tabBar: boolean }` into `src/navigation/shellChrome.ts`, returning all `true` for every route, and have `App.tsx` use it for the three props. `shellChrome.test.ts` asserts all-true for `qr-studio` and for `dashboard`, and iterates every id in the `appRoutes` list. Additionally an `AppShell` render test passes `navigation`, `footer` and a tab-bar child and asserts all three are in the document. Layout check: `<main>` becomes shorter once the footer/tab bar show, so `QrStudioPage` root must use `h-full min-h-0` (not `min-h-screen`/`h-screen`) with an internal scroll container; verified by reading the current root class and by the screenshots in section 10.

New props passed from App (same pattern as `InputControlPage`):

```ts
interface QrStudioPageProps {
  onExit?: () => void
  devices: string[]                      // `devices` from useScrcpy: serials returned by get_devices
  deviceLabels?: Record<string, string>  // workspaceDeviceLabels (App.tsx ~l.1579)
  activeDevice: string                   // activeAndroidWorkspaceDevice (App.tsx l.661)
  onSelectDevice: (serial: string) => void
  customPath?: string                    // config.scrcpyPath
  notify: ToolbarNotifier                // existing notifier (-> showAlert), see 8 for the critical path
}
```

`devices` is verified online-only: the Rust `get_devices` (`commands.rs` ~l.490) keeps only records whose `adb_state == "device"`, and `useScrcpy` stores that list (`setDevices(newDevices)`, l.424). Unauthorized/offline devices are therefore not selectable and the header shows "No device connected" when the list is empty.

Decision (no fallback branch): App passes
`onSelectDevice={(serial) => { setActiveDevice(serial); setActiveIosUdid(null); setActiveCompanionWorkspaceId(null) }}`.
It deliberately does NOT use `openDeviceWorkspace` (l.591), which also calls `handleNavigate('dashboard')` and would leave the page. Clearing `activeIosUdid`/`activeCompanionWorkspaceId` is required because `activeAndroidWorkspaceDevice` is `''` while either is set. Test: render the page with a mock `onSelectDevice`, choose a device in the header Select, assert the callback gets the serial; an `App`-level selection test is not required. Call site: `qrStudio={<QrStudioPage ... />}`.

### 1.2 Destinations

Single source of truth in `src/components/qr-studio/destinations.ts`:

```ts
export type QrDestination = 'create' | 'templates' | 'device-actions' | 'tools' | 'library'
export const QR_DESTINATIONS = [
  { id: 'create', label: 'Create', icon: QrCode },
  { id: 'templates', label: 'Templates', icon: Palette },
  { id: 'device-actions', label: 'Device Actions', icon: Smartphone },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'library', label: 'Library', icon: Library },
] as const
```

`QrStudioPage` becomes a thin container (target <200 lines): holds `useQrStore()` (section 2.2), the active destination (`useState<QrDestination>('create')`, persisted to `sessionStorage` key `scrcpy-gui-plus:qr-studio:tab`), the header, the tab bar and exactly one active panel. Only the active panel is mounted (`{dest === 'create' && <CreatePanel/>}`), so inactive destinations occupy no layout and no DOM. Unsaved Create draft survives tab switches because the draft state lives in `useQrDraft()` in the container (not inside `CreatePanel`).

Tab bar is a `role="tablist"` with `role="tab"`, `aria-selected`, roving tabindex, Arrow/Home/End key handling, and `role="tabpanel"` with `aria-labelledby`. At widths under 1100px the tab labels collapse to icons with `aria-label` and Tooltip.

### 1.3 Header and device selector

`QrStudioHeader`: left = icon + title "QR Studio" + subtitle; middle = tab bar; right = counts (Saved, Links, kept from the current header) and `QrDeviceSelect`. `QrDeviceSelect` (a thin wrapper, new file `QrDeviceSelect.tsx`) uses the new shared `Select` primitive (8.5) over the `devices` prop, shows label (`deviceLabels[serial] ?? serial`), displays "No device connected" disabled state when `devices.length === 0`. It does not poll ADB itself; the app's existing device state is the single source of truth. iOS/companion workspaces are not targets (the existing `activeAndroidWorkspaceDevice` is `''` for them), so Device Actions treat `''` as "no Android device".

## 2. Data model and persistence

### 2.1 Types (`src/types/qrStudio.ts`)

```ts
export type QrContentType =
  | 'url' | 'text' | 'wifi' | 'contact'      // v1 values preserved exactly
  | 'deep-link'                               // v1 value preserved
  | 'app-link' | 'email' | 'phone' | 'sms' | 'location' | 'event' | 'custom'  // 12 total

export interface QrRecord {
  id: string; name: string; content: string; contentType: QrContentType
  svg?: string                   // optional: v1 records keep it, new records omit it; read ONLY via getRecordSvg()
  style: QrStyle
  createdAt: string; updatedAt: string
  favorite?: boolean
  source?: 'created' | 'decoded' | 'imported'   // drives the Open-on-Device confirm (6.0)
  folderId: string | null        // null = Uncategorized
  tags: string[]                 // tag ids
  notes: string                  // max 2000 chars
  trashedAt: string | null       // ISO when in Trash
  lastUsedAt?: string | null     // for Recent
  fields?: QrFieldValues         // structured form values, so edit reopens the form
}
export interface QrFolder { id: string; name: string; createdAt: string }
export interface QrTag { id: string; name: string; createdAt: string }
export interface QrTemplate { id: string; name: string; style: QrStyle; builtIn?: boolean; createdAt: string }
export interface QrStudioState {
  schemaVersion: 2
  records: QrRecord[]; folders: QrFolder[]; tags: QrTag[]; templates: QrTemplate[]
}
```

The 12 types are: URL, Text, Wi-Fi, Contact(vCard), Deep Link, App Link, Email, Phone, SMS, Location, Event, Custom. `QrFieldValues` is a discriminated union keyed by type (e.g. `{type:'wifi', ssid, password, security:'WPA'|'WEP'|'nopass', hidden}`), kept only in the record's `fields`.

### 2.2 Persistence and migration (`src/services/qrStudioService.ts`)

Decision: new storage key `scrcpy-gui-plus:qr-studio:v2` holding `QrStudioState`. The v1 key `...:v1` is never modified or deleted by the app. This makes migration non-lossy and rollback-safe (downgrading the app still finds the untouched v1 data).

`loadQrStudioState(storage)`:
1. Read v2. If present and parses as an object with `schemaVersion === 2`: sanitize each collection (drop entries failing structural checks), return.
2. If v2 is absent: read the raw v1 string and run the NEW function `migrateV1(raw: unknown[]): { records: QrRecord[]; dropped: number }`. It does not reuse the lossy `loadQrRecords` (which discards any record without a string `svg`). Rules: keep every element that is an object with string `id`, `name` and `content`; everything else (non-objects, missing id/content) is counted in `dropped`. A missing/invalid `svg` is not a reason to drop: `svg` stays undefined and is regenerated lazily via `generate_qr_svg` + `styleQrSvg`. `style` is merged over `DEFAULT_QR_STYLE`; `createdAt`/`updatedAt` preserved, falling back to `new Date().toISOString()` only when missing or unparseable; `folderId:null, tags:[], notes:'', trashedAt:null, source:'imported'`; unknown extra fields are carried through unchanged; a `contentType` outside the 12-value set maps to `'custom'`. Seed `templates` with the built-ins. If `dropped > 0` a non-blocking notice reports "N unreadable entries were skipped; the original data is kept". The v2 state is then written; the raw v1 key is never modified or deleted and serves as the backup. Idempotency: once the v2 key exists, step 1 applies and v1 is never read again.
2a. v2 absent and the v1 key is present but is not valid JSON, or is valid JSON that is not an array: treat as corrupt v1. Do NOT write v2 and do not touch v1. Copy the raw string to `scrcpy-gui-plus:qr-studio:v1:corrupt-<timestamp>` (best effort), start with an empty in-memory state seeded with built-in templates, set `readOnly` (writes to v2 blocked) with the notice "Previous library data could not be read; a backup was kept" and a "Start fresh" action that clears `readOnly` and permits writing v2. Logged `console.warn`. Test: v1 `"{oops"` and v1 `{"a":1}` each yield empty state, `readOnly`, backup key, and no v2 key written.
2b. Quota / write failure during migration: the migrated state is held in memory and `persistError` is set (critical banner). If the first v2 `setItem` throws, no v2 key exists, so the next load re-runs migration from the untouched v1 (v1 is never marked consumed; there is no consumed marker at all, "consumed" is simply the existence of a valid v2 key). Doubling mitigation (decision, this wins over any earlier "svg is kept" wording): the v2 copy of a migrated record KEEPS `svg` only if the total serialized v2 payload stays under 2.5 MB; otherwise `svg` is dropped from the v2 copy (v1 retains the original, and `getRecordSvg` regenerates). Test with a throwing `setItem`: state is usable in memory, `persistError` set, v1 string unchanged, second load migrates again. Test with a payload over the threshold: v2 records have no `svg`, v1 untouched.
3. v2 present but unparseable, or parsed but `schemaVersion !== 2` (including a non-number or a future value written by a newer build to the same key): treat as corrupt. Do not overwrite; copy the raw string to `scrcpy-gui-plus:qr-studio:v2:corrupt-<timestamp>`, start with an empty in-memory state, set a `readOnly` flag that blocks writes to the v2 key until the user clicks "Start fresh" in the notice (which writes the empty state), and show "Library data could not be read; a backup was kept". Logged with `console.warn`. A future v3 build uses a new key (`...:v3`), so no `schemaVersion > 2` rule exists under the v2 key.

Editing records without `fields` (all v1 records, and any record whose structured fields are absent): `parseFields(contentType, content): QrFieldValues | null` is the inverse of each encoder in 2.3. Edit calls it; on success the type form is populated; when it returns `null` (including all unparsable v1 wifi/contact/deep-link content) Edit opens the record as type `custom` with the raw content, and a hint "Structured fields could not be restored" is shown. No data is altered by merely opening Edit.

Migration tests: v1 record without `svg` survives; records with unknown extra fields keep them; a second load does not re-migrate (v1 string unchanged, v2 stable); the v1 raw string is byte-identical after migration; non-object / id-less entries are counted in `dropped`; corrupt v2 produces a backup key and `readOnly`; `schemaVersion: 3` under the v2 key is treated as corrupt.

Write path: `saveQrStudioState` wraps `setItem` in try/catch. `QuotaExceededError` is recoverable: the store keeps in-memory state, sets `persistError`, and shows a critical-level notification "Could not save: storage is full. Export or empty Trash." The user is never told it saved when it did not.

Scale: every record stores its SVG string (~3-20 KB). localStorage ~5 MB limits this to roughly 300-1500 records, not "thousands". Decision: stop persisting `svg` for new records. Persist `content` + `style` (+ `fields`) and regenerate the SVG lazily via `generate_qr_svg` plus `styleQrSvg` with an in-memory LRU cache (300 entries, keyed by `contentType|content|errorCorrection`, then restyled per call; styling is a cheap string replace). v1 records that include `svg` keep it (non-lossy) and `svg` becomes optional (`svg?: string`) in v2. Estimated v2 record size ~0.4 KB so 5,000 records ≈ 2 MB. When quota is still exceeded, the persist error path above applies. A true IndexedDB move is out of scope (see section 11).

`getRecordSvg(record: QrRecord, opts?): Promise<string>` in `qrStudioService.ts` is the single accessor for a record's SVG. It returns `record.svg` when present, otherwise generates via `generate_qr_svg` + `styleQrSvg` through the LRU cache. Cards, list rows, details, downloads, copy, Open/Send to Device and the template bulk restyle MUST call it; no component reads `record.svg` directly (enforced by a Vitest test that greps `src/components/qr-studio` for `\.svg\b` on records, and by the type being optional). Tests: a v1 record without `svg` renders a thumbnail and downloads via `getRecordSvg`; a record with `svg` skips the Tauri call; a generation failure rejects and the caller shows an inline error.

Store hook `useQrStore()` in `src/components/qr-studio/useQrStore.ts`: `useReducer` over `QrStudioState`, persists in an effect debounced 250 ms plus flush on `beforeunload`/unmount, exposes actions (`saveRecord`, `saveMany`, `updateRecord`, `trash`, `restore`, `deleteForever`, `emptyTrash`, `moveToFolder`, `createFolder`, `renameFolder`, `deleteFolder`, `addTag`, `renameTag`, `deleteTag`, `setTags`, `toggleFavorite`, `saveTemplate`, `deleteTemplate`). Reducers are pure functions in `qrStudioStore.ts` so they are unit testable without React.

### 2.3 Per-type encoding helpers (`src/services/qrEncoders.ts`)

Pure functions `encode(fields): { ok: true, content: string } | { ok: false, errors: Record<string,string> }`:

- wifi: `WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;H:<true|>;;`. Escape `\ ; , : "` with a backslash in ssid and password. `nopass` omits `P`. SSID required, ≤32 bytes; password 8-63 chars for WPA, 5/13 for WEP.
- email: `mailto:<addr>?subject=<enc>&body=<enc>` (encodeURIComponent, address validated with a simple RFC-lite regex).
- phone: `tel:+<digits>` (allow `+`, digits, spaces/dashes stripped; 3-20 digits).
- sms: `SMSTO:<number>:<message>`.
- location: `geo:<lat>,<lon>[?q=<label>]`; lat -90..90, lon -180..180.
- event: `BEGIN:VEVENT` ... `END:VEVENT` wrapped in `BEGIN:VCALENDAR`; `DTSTART`/`DTEND` as `YYYYMMDDTHHMMSSZ` (or all-day `YYYYMMDD`), `SUMMARY`, `LOCATION`, `DESCRIPTION` with RFC 5545 text escaping (`\\ \; \, \n`), CRLF line endings. End must be after start.
- contact: vCard 3.0 `BEGIN:VCARD VERSION:3.0 N: FN: TEL: EMAIL: ORG: URL: END:VCARD` with the same escaping.
- deep-link: `scheme://host/path?query` built by the Deep Link Builder; validated by the same rule as Rust `validate_uri` (non-empty, ≤4096, no control characters).
- app-link: `https://` URL with host required (Android App Link / universal link style).
- url: normalised with the `URL` constructor, only `http:`/`https:` accepted for type URL.
- text, custom: passthrough; custom allows any non-empty string.

Every encoder is also covered by a `detectType(content)` inverse used for Decoder results (maps `WIFI:` → wifi, `mailto:` → email, etc.). Capacity check: `estimateQrCapacity(content, ec)` uses byte length against the QR byte-mode limits (L 2953, M 2331, Q 1663, H 1273) and fails validation before calling Rust. Rust errors from `generate_qr_svg` are also surfaced.

## 3. Create destination

`CreatePanel` is composed of: `TypePicker` (12 types, `Select`), `TypeFields` (per-type form; `custom/text` use a textarea), `DesignControls` (existing fg/bg/EC/size; "Customize" now opens real color inputs; template apply dropdown), `LivePreview` (existing 180 ms debounced `generateQrSvg` + `styleQrSvg`), `QualityPanel`, and action bar.

- Single/bulk mode kept. Bulk keeps the `name|content` line format via `parseMultiQrInput` and applies the chosen type's validation to each line. Per-line failures are listed and valid lines still save only after the user confirms "Save N valid, skip M invalid". Limit 200 lines per bulk save.
- Validation rules: name optional (default `QR Code <n>`), ≤80 chars, trimmed; content required, ≤ capacity of chosen EC; colours must match `^#[0-9a-fA-F]{6}$`; size integer 256-4096 (clamped, existing default 1024).
- Quality validation (`qrQuality.ts`, pure): contrast ratio via the existing `colorContrast` (warn <3, error <2, plus warn when foreground is lighter than background = inverted QR, which many scanners fail), size < 256 warn, EC `L` with content >60% of capacity warn, content length warns, and the round-trip decode result (below). Output `{level:'ok'|'warn'|'error', issues: {code,message}[]}`; `error` disables Save/Download, `warn` allows with visible message.
- Actions: Download PNG, Download SVG (existing helpers), Copy (existing: image to clipboard when available, else content text; the existing behaviour is preserved and the label tells which), Save (new record or update when `editingId`), Reset (confirm via `Dialog` only when draft is dirty), Save as template.
- Decode round-trip test: button "Verify scan". Rasterises the styled SVG to a canvas (`Image` + `canvas.toBlob('image/png')`, 512px), sends the bytes to the Tauri command `qr_decode_image`, and compares decoded text with the intended content. Result states: Verified / Mismatch / Could not decode, never shown as verified unless equal. In jsdom/web-only (no Tauri) the button is disabled with "Requires the desktop app". In unit tests the service call is mocked.
- Errors: preview generation failure → inline error in preview, last good preview dimmed, Save disabled; Tauri `invoke` rejects are caught, logged `console.error` with context, and shown inline. Save failure (quota) per 2.2.

## 4. Templates destination

`QrTemplate` stores `QrStyle` only. Built-ins (not deletable, flagged `builtIn`): Classic (black/white), Inverted-safe dark text on light grey, Navy, Coral, High contrast, and Soft. Users create from the current Create design ("Save as template", name required ≤40 chars, case-insensitive unique) and can rename/delete user templates (delete is confirmed via `Dialog`). Cards show a live mini QR sample rendered with `styleQrSvg` over a fixed sample SVG (cached once). Actions: Apply to Create (switches destination to Create and sets style), Apply to selected library records (bulk restyle, regenerates svg if present), Rename, Delete. Persisted in `QrStudioState.templates` (v2 key). Applying a template that fails the contrast check shows the warning rather than blocking.

## 5. Library destination

### 5.1 Layout

Three regions inside the panel: Folders rail (left, 220px, collapsible to a `Select` under 1100px), main list (toolbar + content), details sidebar (right, 320px) which at widths under 1280px becomes the `Drawer` primitive instead of a column, so the main list is never squeezed below about 560px.

### 5.2 Folders

System views (not stored): All (excludes Trash), Uncategorized (`folderId===null`, not trashed), Favorites, Recent (records with `lastUsedAt` or `updatedAt` in last 14 days, sorted desc, max 50), Trash. Custom folders: flat list (no nesting; nesting out of scope), CRUD via `Dialog`. Name rules: required, trimmed, ≤40 chars, case-insensitive unique among folders, reserved names (All, Uncategorized, Favorites, Recent, Trash) rejected. Deleting a folder opens a confirm Dialog: "N codes will be moved to Uncategorized. The codes are not deleted." On confirm, records move to `folderId:null`, then the folder is removed (single reducer action, atomic). Move: card menu, bulk bar and details panel use a `Select`/`Menu` of folders.

Trash: "Delete" on a record only sets `trashedAt` (soft delete). Trash view shows Restore (clears `trashedAt`; if its folder no longer exists, `folderId` is reset to null), Delete forever (confirm), and Empty Trash (confirm, shows count, irreversible, destructive style, Cancel is the default focus). No auto-purge in this iteration.

### 5.3 Tags

Tags are stored once in `state.tags`; records hold tag ids. Create-on-type in a tag input; CRUD in a "Manage tags" `Dialog`. Name rules: trimmed, 1-24 chars, no commas; case-insensitive dedupe (`name.toLocaleLowerCase()` compare; the first-created casing is kept; trying to add a duplicate selects the existing tag). Rename that collides with another tag is rejected with an inline message. Deleting a tag removes its id from all records after a confirm. Filter: multi-tag filter with AND semantics in the toolbar via Popover.

### 5.4 Search, filter, sort, view

- Search: debounced 150 ms over name, content, notes, tag names, case-insensitive. For `wifi` records the searchable content is the REDACTED form (`redactWifi(content)`: `P:<password>` replaced by `P:••••`), so the password is never indexed or matchable; SSID remains searchable; implemented as pure `selectRecords(state, query)` with a pre-lowercased `searchKey` computed in a `useMemo` map.
- Type filter chips/select with live counts (computed for the current folder + search, excluding the type filter itself, so counts stay meaningful).
- Sort: Updated (default, desc), Created, Name A-Z / Z-A, Type. Stable sort with id tie-break. Persisted in `localStorage` key `scrcpy-gui-plus:qr-studio:ui`.
- View: grid (cards) or list (dense rows), same selection model, persisted in the same UI key.

### 5.5 Scale strategy

No virtualization library. Decision: windowed rendering implemented in a small hook `useWindowedList` for both views. Rows have fixed height (list: 56px; grid: fixed card height 232px with column count computed from container width via `ResizeObserver`). The hook computes visible row range from `scrollTop` of the panel's own scroll container plus 3 rows overscan, and renders a spacer for the rest. This handles 5,000+ records with ~30-60 DOM nodes of cards. Card thumbnails render the QR through `<img src="data:image/svg+xml...">` via the LRU cache, generated only for visible records (so 5,000 records do not trigger 5,000 Tauri calls). Filtering/sorting/counts are O(n) or O(n log n) on in-memory arrays (negligible for 5k). The old "Load more" pagination is removed. In jsdom (no layout), fallback sizes are constants exported by the hook module (`FALLBACK_VIEWPORT_HEIGHT = 800`, `FALLBACK_CONTAINER_WIDTH = 1000`) used when measured size is 0, and are overridable through optional hook props (`initialViewportHeight`, `initialContainerWidth`) that tests pass; tests also inject a fake `ResizeObserver` and `scrollTop`.

### 5.6 Selection and bulk actions

`selectedIds: Set<string>` in `useLibrarySelection()`. Checkbox on each card/row, "select all in view" (current filtered result, not just rendered), shift-click range, Escape clears. Bulk bar (sticky at the top of the list, appears when ≥1 selected): Move to folder, Add/Remove tags, Favorite, Download (SVG zip is out of scope; bulk download triggers individual PNG downloads capped at 20 with a notice, otherwise disabled with tooltip "Select 20 or fewer"), Delete (to Trash, confirm if >5). In Trash view the bar offers Restore and Delete forever. Selection is pruned when records leave the filtered view.

### 5.7 Cards and details

Card: checkbox, thumbnail, name, type badge, folder + tag chips, updated time, favorite star, quick actions (Download PNG, Copy), and a "⋯" `Menu` (Preview, Edit, Duplicate, Move to…, Download SVG, Open on device, Delete/Restore). Details sidebar (selected single record = the last clicked): large preview, editable name, notes (≤2000), folder select, tag editor, content with copy (for `wifi` records via `redactWifi`: the password shows as `••••` with a "Reveal" toggle (default hidden, reset on selection change); Copy copies the real content only after an explicit click and list rows/cards always show the redacted form), style summary, created/updated, actions (Edit in Create, Duplicate, Download PNG/SVG, Open on Device, Trash). Edits save on blur with the reducer action; empty name is rejected (reverts). Edit in Create loads the record (including `fields`) into the draft, sets `editingId`, and switches to Create.

## 6. Device Actions destination

Uses the `devices`/`activeDevice`/`customPath` props. Every action first checks `activeDevice !== ''`; otherwise the buttons are `disabled` with `aria-disabled` and a visible text "Connect an Android device to use this action" (not tooltip-only).

### 6.0 Prerequisite: shell-quoting fix in `launch_deep_link` (security, HIGH)

Verified in `src-tauri/src/deep_link.rs`: `validate_uri` rejects only empty, >4096 bytes and control characters, and `launch_deep_link` passes `uri` (and `-p <package>`) as plain argv entries to `adb shell am start ...`. `adb shell` joins its arguments into one string that the DEVICE shell re-parses, so `&`, `;`, `|`, `$()`, backticks, spaces and quotes in the URI are interpreted on the phone: `https://x/?a=1&b=2` is truncated at `&` and `https://x/;reboot` runs a second command. Earlier text claiming the command "validates the URI" as a safety measure was wrong; validation is not a defence here. QR content is untrusted (decoded images, imported text), so this is a command-injection path that this design would widen (sms/geo/mailto URIs, Capture & Decode, Decoder tool). Fix, required before any Open on Device UI ships:

- Add `fn sh_quote(s: &str) -> String { format!("'{}'", s.replace('\'', r"'\''")) }` in `deep_link.rs`.
- Build args with `sh_quote(&uri)` for the `-d` value and `sh_quote(p)` for the `-p` value (package is already validated by `validate_package_name`, quoted anyway as defence in depth). `-a android.intent.action.VIEW` is a constant.
- Extract `fn build_launch_args(uri: &str, pkg: Option<&str>) -> Vec<String>` so quoting is unit testable without ADB.
- Rust tests assert the argv value for `-d` is exactly the quoted string for: `https://x/?a=1&b=2` -> `'https://x/?a=1&b=2'`; `a;reboot` -> `'a;reboot'`; `$(id)` -> `'$(id)'`; a backtick URI; a URI containing `'` (`it's` -> `'it'\''s'`); a URI containing a space; and that the `-p` value is quoted. Also a test that control characters and empty input are still rejected.
- Scope: this changes the shared `launch_deep_link`, so existing callers (`DeepLinkPage`, `deep-link-launcher`, tests under `src/components/deep-link-launcher`) get the fix too. Behaviour change for legitimate URIs: URIs with `&` now work instead of being truncated. The implementer greps frontend tests that assert on invoke arguments (the argument shape to Rust is unchanged; quoting happens inside Rust) and notes the fix in the handoff.
- `qr_send_to_device` builds its own broadcast args from a sanitized filename (`[A-Za-z0-9._-]` only), so it is not affected, but it uses the same `sh_quote` for the `file://` URI for consistency.

Frontend confirm rule: Open on Device for any record whose origin is decoded or imported (Decoder tool, Capture & Decode, `origin: 'decoded'` flag on the record `source` field, set when saved from those flows), and for any content not authored in the Create form in this session, opens an `alertdialog` Dialog showing the exact URI (monospace, wrapped, scrollable) with "Open on device" and Cancel (default focus Cancel). `QrRecord` gains optional `source?: 'created' | 'decoded' | 'imported'` (v1 migrated records get `'imported'`, i.e. confirm applies). Records created in Create in the current app run launch without the extra confirm.

### 6.1 Open on Device (existing mechanism, after the 6.0 fix)

Target: a saved record (picker from Library) or the current Create draft. Calls existing `launchDeepLink(serial, content, undefined, customPath)`, which runs `am start -a android.intent.action.VIEW -d '<quoted uri>'` (after the 6.0 fix) and validates serial/URI shape in Rust. Subject to the confirm rule in 6.0. Applicable to content types whose content is a URI: url, deep-link, app-link, email (`mailto:`), phone (`tel:`), sms (`smsToViewUri`, below), location (`geo:`). `smsToViewUri(content)` (in `qrEncoders.ts`): parse `SMSTO:<num>:<msg>` (split on the first `:` after the number; the message may contain `:`); the number must match `^\+?[0-9]{3,20}$` else return `null` (action disabled with "Invalid phone number"); output `sms:<num>?body=<encodeURIComponent(msg)>`, omitting the query when `msg` is empty. `geo:` content is passed unchanged. Unit tests cover empty message, message with `:`/`&`/non-ASCII, and invalid number. For wifi/contact/event/text/custom it is disabled with "This type is not a launchable link". The result's `success`/error code is shown via `notify`; an "Error: Activity not started" stdout (already detected in Rust) is reported as "No app on the device handles this link". The record's `lastUsedAt` is updated on success.

### 6.2 Send to Device (new command, truthful)

Mechanism: new Tauri command in a new file `src-tauri/src/qr_device.rs`:

```rust
#[tauri::command]
pub async fn qr_send_to_device(serial: String, filename: String, png_base64: String, custom_path: Option<String>) -> QrDeviceResult
```

It validates the serial with `adb::validate_serial`, builds the remote filename itself, because `sanitize_filename_component` (screenshot.rs:222, `pub`) only replaces unsafe characters, collapses underscores, trims `_`/`.` and falls back to `"device"`; it neither forces an extension nor caps length. The command does: `let stem = sanitize_filename_component(stem_of(&filename)); let stem = truncate_chars(&stem, 80); let name = format!("{stem}-{:08x}.png", short_hash(png_bytes));` The 8-hex content hash suffix is the collision rule: re-sending the same QR yields the same name (idempotent overwrite of identical content), while a different QR with the same title never overwrites another. Rejects payloads over 8 MB (decoded) or non-PNG bytes (`screenshot::validate_png`), writes the bytes to a temp file in the OS temp dir with a unique name, runs `adb -s <serial> push <tmp> /sdcard/Download/<name>` through `adb::run_adb_text` (array args, no shell), then best-effort `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/<name>` (failure of the broadcast is ignored, noted in the result `scan:false`), and always deletes the temp file. Result: `{ success, path_on_device?, error_code?, error? }`. The UI says "Saved to Downloads/<name> on <device>"; it does not claim the image is displayed. Rust tests (no ADB needed) cover: extension always `.png` even for input `a.exe` or `../x`, length cap 80 chars of stem on multibyte input, empty stem -> `device`, same bytes -> same name, different bytes -> different name. `push_file` is not reused because it takes a pre-existing local path and has no validation or sanitization; a PNG held in memory must be materialised first. If the push fails (device offline, unauthorised, storage full), the error code and message are shown and logged at `console.error`. This is recoverable (the user can retry).

### 6.3 Capture & Decode (new command, truthful)

`qr_capture_and_decode(serial, custom_path)` calls the existing `screenshot::capture_png_frame` (already `pub(crate)`), decodes the PNG using the decode helper from 7.3 and returns `{ success, texts: string[], thumbnail_png_base64 }` where `texts` may be empty ("No QR code found on the device screen"). The frame is not written to disk. Multiple codes on screen are all returned. The UI shows the thumbnail, each decoded value with detected type, Copy, "Save to library" (creates a record with the detected type) and "Open on device" where launchable. The thumbnail is downscaled in Rust to at most 480 px wide (`image::imageops::resize`, Triangle filter) and re-encoded as PNG, so the IPC payload is small; the full-resolution frame never crosses IPC. Decoding runs on the full frame. The timeout is `const QR_CAPTURE_TIMEOUT_SECS: u64 = 30;` defined locally in `qr_device.rs` and passed as the `timeout_secs` argument of `capture_png_frame` (the screenshot module's `SCREENSHOT_TIMEOUT_SECS` is private and is left untouched). Errors (`screencap` failure, timeout) are returned as `error_code`/`error` and shown inline; logged by Rust with `eprintln!`-equivalent at the project's existing logging approach.

### 6.4 Scan with camera

Always rendered, always disabled, with persistent explanatory text: "Scanning with the device camera is not available. This app controls devices over ADB and has no access to a device camera feed. Use Capture & Decode to read a code shown on the device screen, or scan the QR on screen with the phone." No handler is attached; the control has `aria-disabled="true"`. This is the honest outcome, and it is not a blocker.

### 6.5 States

Each action card has states idle / running (spinner, button disabled, prevents double submit) / success / error. A "Last result" strip per action. Switching `activeDevice` clears results.

## 7. Tools destination

Four tool cards in a left list and a tool pane; one active at a time.

1. Deep Link Builder: fields scheme (required, `^[a-z][a-z0-9+.-]*$`), host, path, query rows (key/value, URI-encoded), fragment; live preview of the URI; optional Android package (validated like `adb::validate_package_name` shape `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`) used for Open on Device. Buttons: Use in Create (type deep-link), Open on Device (via 6.1), Copy.
2. Wi-Fi QR Generator: the Wi-Fi form from 2.3 as a standalone tool with show/hide password (default hidden), "Use in Create", and a warning "The password is embedded in the QR and visible to anyone who scans it". Password is never written to localStorage unless the user saves the record (record `fields` stores it; the details panel and list rows mask it by default via `redactWifi`, and it is excluded from the search key; see 5.4/5.7). Test: searching for the password returns no record, the details panel text does not contain the password until Reveal is clicked.
3. QR Decoder from image: choose a file (`<input type="file" accept="image/png,image/jpeg">`, or drag-drop, or paste), limit 10 MB, reads to bytes, sends to `qr_decode_image`. Output: decoded text(s), detected type, Copy, Save to library, Open as Create. Errors: unsupported type, too large, not decodable → inline message. Webp/gif are not accepted (the Rust `image` crate has png and jpeg only enabled); the UI says so.
4. QR Quality Checker: paste/typed content + style (or "Use current Create draft" / pick a library record) → runs `qrQuality` and the round-trip decode, and reports findings from 3. The existing contrast checker moves here and into Create.

### 7.3 Decoder decision

Options: (a) JS `jsqr` npm package; (b) browser `BarcodeDetector`; (c) Rust `rqrr` crate. (b) is not available in WebKit (macOS Tauri) and is unreliable on WebView2, so it cannot be the product behaviour. (a) and (c) both add a dependency. (c) is chosen: the image decoding stack (`image` png/jpeg) is already in Cargo, the work runs off the UI thread, the same code serves Capture & Decode (which holds raw PNG bytes in Rust anyway), and the decode logic is unit-testable with `cargo test` using `qrcode`-generated fixtures (generate → render to image → decode → equal). Decision: add the exact line `rqrr = { version = "=0.11.0", default-features = false }` to `src-tauri/Cargo.toml` (rqrr 0.11.0 declares `default = ["img"]` and `img = ["image"]`, so a plain `rqrr = "=0.11.0"` WOULD pull `image`; `default-features = false` is mandatory; MSRV of rqrr is Rust 1.85.1, so the implementer first checks `rustc --version` >= 1.85.1 and `rust-version` in Cargo.toml) (0.11.0 is the version `cargo search rqrr` returned while writing this design; its dependencies per crates.io are `g2p ^1.0`, `lru ^0.18`, and `image >=0.24, <=0.25` as an OPTIONAL dependency plus dev-dependency). Compatibility with the project's `image 0.25.10` (png+jpeg, default features off) is avoided by design: the `rqrr` `img`/`image` feature is NOT enabled (`default-features = false`), so rqrr pulls no `image` copy. Additional verification: `cargo tree -e features -i rqrr` shows no `img` feature. Decoding converts the decoded image with the project's own `image` (`to_luma8()`) and feeds rqrr with `rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| luma.as_raw()[y * w + x])`, then `grids()` and `grid.decode()` per detected grid. Verification step for the implementer: `cd src-tauri && cargo tree -d | grep -i "^image"` must show a single `image` version, and `cargo build` and `cargo test` must pass. `src-tauri/Cargo.lock` is gitignored in this repo (`.gitignore:81`, `git ls-files` returns nothing), so the `=0.11.0` pin in `Cargo.toml` is the only committed pin; this is stated to the user. New command `qr_decode_image(bytes_base64: String) -> DecodeResult { success, texts, error_code, error }` in `qr_device.rs`, registered in `lib.rs` next to `deep_link::generate_qr_svg` (~line 226). Validation: base64 valid, decoded ≤ 10 MB, dimensions ≤ 8000x8000, format png/jpeg only; errors map to codes `invalid_input`, `too_large`, `unsupported_format`, `no_qr_found`. Decoding runs in `tokio::task::spawn_blocking`. **Flagged to the user as the one new dependency.**

Frontend service: `src/services/qrDeviceService.ts` with `decodeQrImage`, `sendQrToDevice`, `captureAndDecode`, thin `invoke` wrappers in the same style as `deepLinkService.ts`.

## 8. Overlay architecture (critical)

### 8.1 Root-cause analysis

The observed or likely failures have specific causes:

1. Clipping. The card menu is `position:absolute` inside the card, inside the list, inside `<main class="overflow-y-auto">`. Any `overflow` ancestor clips an absolutely positioned descendant that cannot escape it, regardless of its z-index. Raising z-index cannot fix this.
2. Stacking contexts. `AppShell`'s root has an opacity animation with `forwards` fill, `AppShell` wrappers use `z-[var(--z-sidebar)]`/`--z-topbar` on positioned wrappers, and cards that use `transform`, `backdrop-blur`, `filter`, `animate-in zoom-in` (transform/opacity) create their own stacking contexts. A dropdown with `z-50` inside such a card competes only within that card's context; a neighbouring card painted later wins. Fixed-position children of an ancestor with `transform`/`filter`/`backdrop-filter` are positioned relative to that ancestor, not the viewport, so `fixed` modals inside transformed containers are mispositioned and clipped.
3. Z-index inflation. ~20 magic numbers (30, 40, 50, 80, 100, 120, 200, 300, 380-400, 500, 999) with no ordering contract, so each new overlay is bumped until it wins.
4. No portal anywhere: nothing renders outside the scroll/overflow tree, no collision handling, no viewport clamping, so overlays near edges are cut off, and tooltips (`Tooltip.tsx`, `w-48` absolute) overflow the viewport at the edges.
5. Dialog behavioural gaps: `ThemedModal` has no focus trap, no focus restore, no viewport max-height (long content pushes the footer off screen at 720px height), and closes on backdrop click, which is unsafe for destructive confirms. `window.confirm` blocks the thread, is unstyled, and in Tauri webviews may be suppressed.

Fix principle: render overlays in a portal host that sits outside every `overflow`/`transform` ancestor, position with `fixed` + computed viewport coordinates, and order with a semantic z-index scale instead of numbers.

### 8.2 Semantic z-index scale

In `src/index.css` `:root`, ADD new tokens with new names. Existing variables are NOT redefined or aliased: `--z-sidebar: 30`, `--z-topbar: 40`, `--z-drawer: 80`, `--z-modal: 300` keep their values, because their consumers (verified by grep: `MaestroYamlEditorDialog`, `MaestroDataSourceDialog`, `CompanionWorkspaceStage`, `IosWorkspaceStage` fullscreen, `DashboardLayout.tsx`, `Header.tsx`, `SessionsPage`, `RecordingsPage`, `DevicesPage`) would shift relative to each other and to the tab bar otherwise.

```css
--z-layer-base: 0;
--z-layer-raised: 10;          /* sticky headers, selection bars inside a page */
--z-layer-sticky-nav: 30;      /* documentation of the existing sidebar/tab bar level; not used to change them */
--z-layer-dropdown: 1000;      /* menus, selects */
--z-layer-popover: 1050;       /* popovers */
--z-layer-tooltip: 1100;
--z-layer-drawer-backdrop: 1200;
--z-layer-drawer: 1210;
--z-layer-dialog-backdrop: 1300;
--z-layer-dialog: 1310;
--z-layer-critical: 1400;      /* critical notifications (storage failure) */
```

Ordering matches the brief: base < sticky nav < dropdown/menu < tooltip/popover < drawer/backdrop < dialog < critical notification. (Tooltip is above dropdown and popover so a tooltip on a menu item is visible.) All new primitives and QR Studio use only these tokens; the new scale is above every existing literal (max `z-[999]`), so QR overlays are never hidden behind legacy elements. Existing screens are not migrated (section 11). Toast/alert reality: `notify` is `showAlert` (App.tsx l.364), which is rendered by `ThemedModal` at `fixed z-[300]` (verified in `ThemedModal.tsx:68`), NOT a `--z-drawer` consumer (the earlier claim was wrong). Consequence: an alert raised while a QR Dialog (1310) is open would render behind it. Decision: QR Studio does not call `notify` for results while a QR Dialog is open; Dialog-local errors are shown inline in the Dialog, and the storage-full "critical" message is rendered by a QR-local `CriticalBanner` portaled at `--z-layer-critical`, not through `notify`. Outside dialogs `notify` is used as-is for Device Action results. A Vitest static test parses `index.css` and asserts the order of the NEW `--z-layer-*` tokens only.

### 8.3 Positioning approach: shared hook, no new dependency

Options: add `@floating-ui/react-dom` pinned, or write a small hook. Chosen: write `useFloatingPosition` (about 120 lines) in `src/components/ui/overlay/`. Reasons: the app needs only anchor-relative placement with flip/shift and viewport clamping for a handful of primitives; the dependency would add supply-chain surface and a lockfile change for modest code; the algorithm is deterministic and unit-testable as a pure function `computePosition(anchorRect, floatingSize, viewport, {placement, offset, padding})`. If requirements grow (arrow middleware, virtual elements, nested submenus), switching to Floating UI is mechanical because the primitives encapsulate the hook.

`computePosition`: preferred placement (`bottom-start` default, plus `top`, `bottom`, `left`, `right`, `-start/-end` variants); if the floating box overflows the viewport minus `padding` (8px) on the main axis and the opposite side has more room, flip; then shift along the cross axis to stay within bounds; finally clamp, and if the floating element is taller than available space set `maxHeight = available` so it scrolls internally. Returns `{x, y, placement, maxHeight}`. Hook: `useLayoutEffect` measure on open; re-measure on `window` `resize`, and on `scroll` with `capture:true` (captures scrolls of any ancestor, including `<main>`) throttled with `requestAnimationFrame`; also observes anchor and floating size with `ResizeObserver`. If the anchor leaves the viewport entirely (scrolled away) the overlay closes (Menu/Popover) or hides (Tooltip). If the anchor is detached (`!isConnected`) it closes. At zoom 80-150% the logic works in CSS pixels from `getBoundingClientRect` and `visualViewport`/`documentElement.clientWidth`, so browser zoom needs no special casing.

### 8.4 Portal host and layering infrastructure

`OverlayRoot` utility: `getOverlayHost()` lazily creates and returns `<div id="qr-overlay-root">` appended to `document.body` (once; reused afterwards; works in tests). Decision: the host is `body > #qr-overlay-root`, a sibling of `#root`. `#app-overlays` is not used: it lives inside the AppShell root, which carries an opacity animation with `forwards` fill and `overflow-hidden`. Opacity alone does not create a containing block for `position:fixed`, but any future `transform`/`filter` on the shell would silently break fixed overlays, so the host is placed outside the shell entirely. Theme variables: verified that the theme is applied as `document.documentElement.setAttribute('data-theme', theme)` (`useScrcpy.ts:242`) and the `[data-theme='...']` and `[data-mode]` rules in `index.css` target the `<html>` element, so every descendant of `body`, including `#qr-overlay-root`, inherits those variables. `#root` exists in `index.html:25`, so `inert` on `#root` works while a Dialog is open (the overlay root is outside it).

Open overlays are managed by a tiny stack (`overlayStack.ts`): an array of open overlay ids, used for (a) Escape closing only the top-most overlay, (b) outside-click closing only when the click is outside the top-most layer and its anchor, (c) setting `aria-hidden`/`inert` on the app root (`document.getElementById('root')`) while a Dialog is open, and (d) scroll lock on `body` (`overflow:hidden` with scrollbar-width padding compensation) while a Dialog or modal Drawer is open, restored on close.

### 8.5 Primitives (`src/components/ui/overlay/`)

All export from `src/components/ui/index.ts` alongside the existing `Button`, `IconButton`, `Panel`, `Badge` and use their class conventions (`classNames.ts` helper).

**Dialog** `<Dialog open onClose title description size footer role="dialog"|"alertdialog" dismissible closeOnBackdrop>`:
- Portal to the overlay root; backdrop at `--z-layer-dialog-backdrop`, panel at `--z-layer-dialog`.
- Panel is a flex column with `max-height: calc(100dvh - 32px)`: header fixed, body `overflow-y:auto; min-height:0; flex:1`, footer `shrink-0` sticky (always visible at 1280x720 and 80-150% zoom). Width `min(100vw - 32px, size)`.
- Focus trap: on open save `document.activeElement`, move focus to the first element with `data-autofocus` (else first focusable, else the panel with `tabIndex=-1`); Tab/Shift+Tab cycle within the panel; on close restore focus to the saved element if still connected (else body).
- Escape closes only if `dismissible` and it is the top-most overlay. `closeOnBackdrop` defaults to `true` for informational dialogs and `false` for `role="alertdialog"` (destructive confirms): backdrop click and Escape never confirm; Escape on an alertdialog equals Cancel (non-destructive), and the initial focus is the Cancel button. A mousedown that started inside the panel and ended on the backdrop (drag-select) does not close: close only when both `mousedown` and `click` targets are the backdrop.
- `aria-modal="true"`, `aria-labelledby`, `aria-describedby`. `prefers-reduced-motion` disables the animation.
- `ConfirmDialog` convenience wrapper (`useConfirm()` returning `confirm({title, message, confirmLabel, tone:'danger'}) => Promise<boolean>`) replaces every `window.confirm` in QR Studio (the single usage at QrStudioPage line ~392 is removed). The promise resolves false on Cancel/Escape/unmount, so callers never hang.
- Existing `ThemedModal` is not migrated in this change, to avoid touching other screens; it may be re-implemented on top of `Dialog` later (follow-up).

**Menu** `<Menu trigger items placement>`: trigger is a button with `aria-haspopup="menu"`, `aria-expanded`; list renders in the portal at `--z-layer-dropdown` with `role="menu"`, items `role="menuitem"`/`menuitemcheckbox`, roving focus with ArrowUp/Down/Home/End/typeahead, Enter/Space activate and close, Escape closes and returns focus to the trigger, outside pointerdown closes (without swallowing the click that also hits another control), Tab closes. Collision-aware via 8.3 and `maxHeight` scrolling. This replaces the absolute `role="menu"` in the card.

**Popover** `<Popover trigger>`: same engine for arbitrary content (tag filter, tag editor, color picker); non-modal; focus moves in on open when it contains focusables; Escape/outside click close; at `--z-layer-popover` (popover content uses `--z-layer-popover`; a Tooltip opened from inside a popover still wins at `--z-layer-tooltip`).

**Select** `<Select value options onChange disabled placeholder>`: button + listbox in the portal; `role="listbox"`/`option`, `aria-activedescendant`, keyboard navigation, minimum menu width equal to the trigger width. Used for type picker, folder picker, sort, device selector.

**Tooltip** (new `ui/overlay/Tooltip.tsx`, distinct from the legacy `components/Tooltip.tsx`, which is untouched): wraps a child, shows on hover (delay 400 ms) and focus, hides on blur, Escape, pointerleave, scroll; portaled at `--z-layer-tooltip`, `pointer-events:none`, `role="tooltip"` with `aria-describedby` on the trigger, max-width 240, position clamped to the viewport via 8.3. Unmount-safe: timers cleared in cleanup; if the trigger unmounts, the tooltip unmounts with it (state lives in the same component; the portal child is part of the trigger's React tree). Disabled buttons do not fire pointer events, so wrap in a `span` with `tabIndex=0` when the trigger is disabled.

**Drawer** `<Drawer open onClose side="right" modal>`: portaled; backdrop at `--z-layer-drawer-backdrop` and panel at `--z-layer-drawer` (distinct from the legacy `--z-drawer: 80`, which is untouched); width `min(360px, 100vw)`; internal scroll; same focus management as Dialog when `modal`; used for the Library details panel below 1280px width and Folder rail below 1100px. At ≥1280px the details panel is a static column and not an overlay.

### 8.6 Layer behaviour matrix

| Situation | Result |
|---|---|
| Menu open inside Library, user scrolls `<main>` | Position updates via capture scroll; closes when the anchor leaves the viewport |
| Dialog opened from Menu item | Menu closes first (item activation closes it); Dialog restores focus to the menu trigger |
| Tooltip/Menu opened from inside a Dialog or Drawer | Portaled into that surface's layer host so it renders above the dialog content (ruling below) |

Ruling for the last row: a Tooltip, Menu, Select or Popover opened from inside a Dialog or Drawer must render above that surface. Decision: a `LayerContext` provides a "layer host" element. Dialog and Drawer render the layer host as a SIBLING of the panel (child of the same portal container, after the panel), never inside the scrolling body, so no ancestor `overflow` or `transform` applies. Primitives opened from within the surface portal into this host and use `position:fixed`; the host and the panel sit in the same stacking context created by the dialog portal container (z-index `--z-layer-dialog`), and within it the layer host has `z-index: 1` over the panel (`z-index: 0`), so ordering is local and correct whatever the numeric tokens are. Outside any surface the primitives portal into `#qr-overlay-root` and use the numeric tokens directly. This resolves the 8.5/8.6 conflict: INSIDE a Dialog/Drawer, the layer host wins; otherwise the global tokens apply. The Dialog panel entry animation uses `opacity` only (no `transform`) so the panel never becomes a containing block for fixed descendants.

### 8.7 Testing the overlay layer

Unit (jsdom): `computePosition` table tests (flip bottom→top, shift at left/right, clamp, maxHeight when taller than viewport, 5 viewport sizes); overlay stack (Escape closes only the top); Dialog (focus trap cycle, focus restore, Escape, alertdialog backdrop does not close, body scroll lock released on unmount, long body scrolls while footer present in DOM); Menu (arrow keys, Escape returns focus, outside click closes, item click closes); Tooltip (timer cleanup on unmount using fake timers, no state update after unmount); Select; ConfirmDialog promise resolves false on Escape; z-token ordering test. jsdom has no layout, so geometry is injected by mocking `getBoundingClientRect`. Visual checks (real clipping, stacking against sticky nav) cannot be asserted in jsdom and are handled by manual/screenshot verification (section 10).

## 9. Responsive strategy

Layout uses container-driven rules and min/max constraints rather than fixed pixel designs.

| Viewport | Library | Create | Chrome |
|---|---|---|---|
| 1920x1080 | rail 220 + list + details 320 | form column + preview column (2 columns) | full labels |
| 1536x864 (≈125% on 1920) | same, grid 4-5 cols | 2 columns | full |
| 1366x768 | rail 200 + list + details 300, grid 3-4 cols | 2 columns, preview sticky | full |
| 1280x720 | rail 200 + list; details as Drawer; grid 3 cols | 2 columns; design panel collapsible | tab labels shown |
| 1024x768 | rail becomes a folder `Select`; details Drawer; grid 2 cols | single column, preview above form (collapsible) | tabs icon-only with tooltips |

Zoom 80-150% changes the effective CSS viewport (e.g. 150% at 1920 ≈ 1280 CSS px wide and 720 tall), so those cases are covered by the same breakpoints; no zoom-specific code. Rules: page uses `min-h-0 flex-1` with its own scroll container (so the list can be windowed); Dialog body scroll with sticky footer addresses the 720px-height case; toolbar wraps to two rows (`flex-wrap`) instead of overflowing; text sizes use existing tokens; targets ≥ 32px high; no horizontal scrolling at ≥1024px; horizontal overflow checks in tests compare `scrollWidth <= clientWidth` is not possible in jsdom, so this is a manual check. Breakpoints are applied with Tailwind classes plus a `useContainerWidth` hook (ResizeObserver) for the structural switches (rail→select, details→drawer), since those depend on the panel's width, not the window's width (the app sidebar consumes width).

## 10. Testing and verification plan

- Rust: `cargo test` for `qr_decode_image` (round-trip using `qrcode` + `image` fixtures; invalid base64; oversize; non-image), `qr_send_to_device` argument validation and filename sanitization (no ADB needed; the adb call path is not unit tested), `cargo build` for the new dependency.
- Unit (Vitest): encoders (every type incl. escape cases `;`, `:`, `\`, non-ASCII SSID), `detectType`, capacity, quality rules, migration (v1 fixtures: valid, partial fields, unknown contentType→custom, corrupt JSON preserved in backup key, v1 key untouched, idempotent second load), reducers (folder CRUD with move-to-Uncategorized, tag dedupe case-insensitively, trash/restore/empty, restore with missing folder), selectors (search, type counts, sort stable, Recent, Favorites), `useWindowedList` range math, `computePosition`.
- Component (Testing Library + user-event): tab switching mounts one panel only; header has device selector and disables Device Actions with no device; Create single/bulk/invalid/edit/reset-confirm; Library bulk flow; Device Actions with `invoke` mocked (Open, Send, Capture, camera always disabled); Tools; overlay primitives (8.7). Existing 5 tests in `QrStudioPage.test.tsx` and 3 in `qrStudioService.test.ts` are updated, not deleted, except the Dashboard-button test (see 1.1). Shell chrome is covered by the mandatory `shellChrome.test.ts` and `AppShell` render test in 1.1. Rust additionally: `cargo tree -d` shows a single `image`.
- Gates before handoff: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `cargo test` and `cargo build` in `src-tauri`.
- Visual: run the app via `npm run tauri:dev` (or `npm run dev` for web-only portions) and capture screenshots of each destination at the five sizes and at 80%/100%/125%/150% zoom, plus open menu near the bottom edge, delete confirm dialog at 1280x720, tooltip at the right edge, and compare against the reference image. This step is manual/semi-automated and cannot be verified in CI; it must be reported as done or not done honestly.

### 10.1 Visual verification checklist (auditable)

Screenshots are saved under `.agents/tasks/qr-studio-shots/` as `<viewport>-<zoom>-<scene>.png`. Each row is marked PASS/FAIL/NOT RUN in `.agents/tasks/qr-studio-verification.md` with the reviewer and date; unmarked rows count as NOT RUN, and the handoff must not claim visual verification for them.

| Scene | Viewports / zoom | Files | Pass criteria |
|---|---|---|---|
| Each of 5 destinations | 1920x1080, 1536x864, 1366x768, 1280x720, 1024x768 at 100% | `<vp>-100-<dest>.png` (25 files) | Sidebar, tab bar and footer visible; no horizontal scrollbar (`document.documentElement.scrollWidth <= clientWidth`, read via devtools/automation and noted); header and device selector fully visible; only the active destination rendered; primary action visible without page scroll on Create at >=1366x768 |
| Zoom | 1920x1080 at 80%, 125%, 150% for Create and Library | `1920x1080-<zoom>-create.png`, `...-library.png` | Same no-overflow rule; Library switches to Drawer details at the effective <1280 CSS px width |
| Delete confirm dialog | 1280x720 and 1280x720 at 150% | `1280x720-<zoom>-confirm.png` | Footer buttons fully inside the viewport; body scrolls when content is long; Cancel focused |
| Card menu near bottom edge | 1366x768 | `1366x768-100-menu-flip.png` | Menu flipped upward, fully visible, not clipped by the list or footer |
| Menu not clipped by scroll container | 1366x768 | `1366x768-100-menu-over-footer.png` | Menu overlaps footer/tab bar region correctly (above them) |
| Tooltip at right edge | 1366x768 | `1366x768-100-tooltip-edge.png` | Tooltip fully inside viewport |
| Dialog over drawer | 1280x720 | `1280x720-100-dialog-over-drawer.png` | Dialog and backdrop above drawer; focus returns to opener on close (noted) |
| Reference comparison | 1920x1080 | `ref-compare.md` | Notes on structural parity (header strip, folder control with add/edit/remove, search+type filter row, checkbox rows, preview card, status line); palette intentionally differs (Caveat A) |

## 11. Out of scope

- IndexedDB or a file-based store; sync; cloud; accounts (offline localStorage only).
- Nested folders; folder sharing; auto-purge of Trash.
- Migrating other screens' modals, tooltips and z-index literals to the new primitives/tokens (follow-up).
- Live camera scanning (impossible with ADB; kept as a disabled control).
- Logo embedding, dot-shape styles, gradients, batch ZIP export.
- WebP/GIF decoding.

## 12. Open items and risks

1. The reference image is a different product (Caveat A); structural ideas are adopted, palette stays navy and coral. Visual fidelity is verified only by screenshots reviewed by a human.
2. `rqrr =0.11.0` (default-features off, Rust >= 1.85.1) is a new Rust dependency; the user must be told. `Cargo.lock` is gitignored in this repo, so the `=` pin in `Cargo.toml` is the only committed pin.
3. The header device selector sets the active device through `setActiveDevice` plus clearing iOS/companion selection (1.1); no fallback is needed.
4. `localStorage` capacity: dropping persisted `svg` for new records is a design decision that changes the record shape (optional `svg`), and old v1 records keep theirs.
5. Overlay primitives are new shared code; their adoption outside QR Studio is deliberately deferred to limit regression risk.

## 13. Implementation order (suggested)

1. Tokens + overlay primitives + tests. 2. Types, encoders, service v2 + migration + reducers + tests. 3. Shell removal in `App.tsx` + container/header/tabs. 4. Create + Templates. 5. Library (selectors, windowing, folders/tags/trash, details). 6. Rust commands + Device Actions + Tools. 7. Responsive pass + screenshots + full gates.

## 14. Responses to design review findings

- 1 (sanitize filename): addressed in 6.2: `qr_send_to_device` builds `stem-<8hex>.png` itself, 80-char stem cap, collision rule, Rust tests.
- 2 (private timeout const): addressed in 6.3: local `QR_CAPTURE_TIMEOUT_SECS = 30` in `qr_device.rs`; the screenshot const is untouched.
- 3 (lossy migration): addressed in 2.2: new `migrateV1`, lazy svg regeneration, dropped count reported, `parseFields` with `custom` fallback, `schemaVersion !== 2` is corrupt (no `> 2` rule), tests listed.
- 4 (device selector): addressed in 1.1/1.3: `onSelectDevice` defined; `devices` verified online-only (`adb_state == "device"`); fallback removed.
- 5 (rqrr): addressed in 7.3: `=0.11.0`, greyscale API over the project's own `image`, no rqrr `image` feature, `cargo tree -d` check; `Cargo.lock` is gitignored (stated).
- 6 (shell removal): addressed in 1.1: three sites are the complete list, `appRoutes.test.ts` acknowledged, `shellChromeForRoute` extraction with mandatory tests, root height check.
- 7 (z aliasing): addressed in 8.2: no aliasing, new `--z-layer-*` names, toast claim corrected (`showAlert` is `ThemedModal` at `z-[300]`), consequence and mitigation stated, token test scoped to new tokens.
- 8 (overlay host): addressed in 8.4/8.6 and Section 0: host is `body > #qr-overlay-root`; `data-theme` is on `<html>`; layer host is a sibling of the panel.
- 9 (SMS): addressed in 6.1: `smsToViewUri` rule and tests.
- 10 (full PNG over IPC): addressed in 6.3: Rust downscales to 480 px.
- 11 (command count): normalised to three new commands in Section 0.
- 12 (jsdom defaults): addressed in 5.5: exported constants plus overridable props.

Iteration 2 (review `design-review.md`, verdict CHANGES_REQUESTED):
- R1 (HIGH, shell injection): addressed in new 6.0: `sh_quote` in `deep_link.rs`, `build_launch_args` helper, Rust tests for `a&b`, `a;reboot`, `$(id)`, backtick, `'`, space, and `-p` quoting; applies to existing callers; frontend confirm Dialog for decoded/imported content via `source` field.
- R2 (MEDIUM, rqrr features): addressed in 7.3: `rqrr = { version = "=0.11.0", default-features = false }`, MSRV 1.85.1 check, `cargo tree -e features -i rqrr` check; Section 0 and 12 text aligned.
- R3 (MEDIUM, svg optional): addressed in 2.1 (`svg?: string`) and 2.2 (`getRecordSvg` single accessor, enforcement test, v1-without-svg test).
- R4 (MEDIUM, migration gaps): addressed in 2.2 steps 2a (corrupt/non-array v1: backup, no v2 write, `readOnly`) and 2b (write failure keeps v1 authoritative, no consumed marker, re-migrates on reload; v2 copy drops `svg` above 2.5 MB; tests with throwing `setItem`).
- R5 (MEDIUM, Wi-Fi password): addressed in 5.4/5.7/7.2: `redactWifi`, Reveal toggle, excluded from search key, tests.
- R6 (NIT, token names): addressed: `--z-layer-*` used throughout 8.4-8.6; note that legacy `--z-drawer` (80) is distinct.
- R7 (NIT, auditable visual checks): addressed in new 10.1 with file names, pass criteria and a verification log.
- Backlogged/ignored: none.
