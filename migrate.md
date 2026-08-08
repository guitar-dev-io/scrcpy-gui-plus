 deliverable ทั้ง 10 ข้อตามที่ขอ (ยังไม่แก้โค้ดจริง เป็นเอกสารแผนงานก่อน ตามที่โจทย์ต้องการ)
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  Mobile Device Studio — Information Architecture Refactor
  
  1. Updated Navigation Tree
  
  Dashboard                                    (unchanged — landing/quick control)
  
  Device Management
    ├─ Devices                                 (existing DevicesPage)
    └─ Sessions                                (existing SessionsPage)
  
  Explorer                                     (NEW — merges File Manager + App Manager)
    ├─ Files            (tab)
    └─ Applications      (tab)
  
  Control                                      (NEW group — surfaces existing modals as
  tabs)
    ├─ Screen           (Dashboard's embedded stream / DeviceControlToolbar screen actions)
    ├─ Input            (Keymap Controller + Input Control settings)
    └─ Automation       (Macro Recorder + Custom Command + Deep Link Launcher)
  
  Development                                  (NEW group)
    ├─ Shell            (Shell Terminal, currently dashboard bottom tab)
    ├─ Logcat           (existing LogcatViewer)
    └─ Wireless ADB      (existing WirelessAdbPage)
  
  Monitoring                                   (NEW group — splits DeviceStatus modal into
  tabs)
    ├─ Performance       (existing Performance placeholder + connection health)
    ├─ Battery
    ├─ Memory
    ├─ CPU
    └─ Network           (ConnectionHealth component)
  
  Media                                        (NEW group)
    ├─ Screenshots       (existing ScreenshotsPage)
    └─ Recordings        (existing RecordingsPage)
  
  Settings                                     (unchanged)
  
  Sidebar top-level count drops from 13 flat items to 8 grouped domains (Dashboard, Device
  Management, Explorer, Control, Development, Monitoring, Media, Settings), each
  collapsible, matching Android Studio/Knox-style grouped trees.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  2. Route Structure
  
  Extend appRoutes.ts from a flat AppRouteId union to a domain/child structure while
  keeping hash-routing:
  
  export type AppRouteId =
    | 'dashboard'
    | 'devices' | 'sessions'
    | 'explorer-files' | 'explorer-apps'
    | 'control-screen' | 'control-input' | 'control-automation'
    | 'dev-shell' | 'dev-logcat' | 'dev-wireless'
    | 'monitor-performance' | 'monitor-battery' | 'monitor-memory' | 'monitor-cpu' |
  'monitor-network'
    | 'screenshots' | 'recordings'
    | 'settings'
  
  export interface AppRouteDefinition {
    id: AppRouteId
    label: string
    path: string          // '/explorer/files', '/monitor/battery', etc.
    group: AppRouteGroupId // NEW: for sidebar grouping + breadcrumbs
  }
  
  export type AppRouteGroupId =
    | 'root' | 'device-management' | 'explorer' | 'control'
    | 'development' | 'monitoring' | 'media' | 'system'
  
  Hash paths become nested (#/explorer/files, #/monitor/battery), parsed by extending
  appRouteFromHash/appRouteToHash — same mechanism, just richer path strings. No router
  library needed, this is a pure data restructuring of the existing hash-route module
  (appRoutes.ts, appRoutes.test.ts already covers this pattern).
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  3. Component Hierarchy
  
  App.tsx (orchestrator — mostly unchanged: owns hooks/state/handlers)
   └─ AppShell
       ├─ AppNavigation (rewritten: renders grouped tree from APP_ROUTE_GROUPS)
       ├─ Footer
       └─ content (route switch)
           ├─ DashboardLayout               (unchanged)
           ├─ DeviceManagementGroup
           │    ├─ DevicesPage              (unchanged)
           │    └─ SessionsPage             (unchanged)
           ├─ ExplorerPage                  (NEW — wraps existing FileManager + AppManager)
           │    ├─ ExplorerHeader           (NEW reusable: device chip, storage bar,
  search, refresh)
           │    ├─ ExplorerTabs             (NEW reusable tab strip: Files | Applications)
           │    ├─ FileManager (embedded)   (existing, embedded=true, chromeless)
           │    └─ AppManager (embedded)    (existing, needs embedded mode added — see §9)
           ├─ ControlGroup
           │    ├─ ControlPanel-derived "Screen" tab (existing
  ControlPanel/DeviceControlToolbar screen bits)
           │    ├─ KeymapController (embedded tab instead of modal)
           │    └─ AutomationTab
           │         ├─ MacroRecorder (embedded)
           │         ├─ CustomCommand (embedded)
           │         └─ DeepLinkLauncher (embedded)
           ├─ DevelopmentGroup
           │    ├─ ShellPage (NEW thin wrapper reusing existing shell/log panel logic)
           │    ├─ LogcatViewer (embedded tab instead of modal)
           │    └─ WirelessAdbPage           (unchanged)
           ├─ MonitoringPage                 (NEW — splits DeviceStatus modal content into
  tabs)
           │    ├─ MonitoringTabs            (NEW reusable tab strip)
           │    ├─ PerformanceTab            (StatCard/UsageBar reused from
  DeviceStatus.tsx)
           │    ├─ BatteryTab
           │    ├─ MemoryTab
           │    ├─ CpuTab (placeholder until backend exposes CPU%, per §10)
           │    └─ NetworkTab (renders existing ConnectionHealth)
           ├─ MediaGroup
           │    ├─ ScreenshotsPage           (unchanged)
           │    └─ RecordingsPage            (unchanged)
           └─ SettingsPage                   (unchanged)
  
  NEW shared layout primitives (src/components/layout/):
   ├─ WorkspaceHeader.tsx     — device chip + status + action slot (extracted from
  DevicesPage/SessionsPage/FileExplorerPage header patterns, which are currently three
  near-duplicate headers)
   ├─ TabStrip.tsx            — generic underline tab bar (extracted from DashboardLayout's
  bottomTab logcat/shell/events tabs and SettingsPage's tab bar, which duplicate the same
  pattern today)
   └─ EmptyState.tsx          — extracted from the 4+ duplicated "no X detected"
  empty-state blocks in DevicesPage/SessionsPage/RecordingsPage/ScreenshotsPage
  
  Nothing existing is deleted or visually changed — FileManager, AppManager, DeviceStatus,
  LogcatViewer, MacroRecorder, CustomCommand, DeepLinkLauncher, KeymapController keep their
  current internals; only their presentation shell changes from "modal triggered by a
  toolbar button" to "tab content inside a grouped route," using each component's existing
  (or newly added) embedded prop.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  4. Explorer Page Layout
  
  ┌─────────────────────────────────────────────────────────────┐
  │ Explorer                                    [Search] [⟳]    │  ← WorkspaceHeader
  (shared)
  │ Pixel 7 · 192.168.1.5:5555 · 82.1GB/128GB ▓▓▓▓▓░░░           │
  ├─────────────────────────────────────────────────────────────┤
  │ [ Files ]  Applications                                      │  ← TabStrip (shared)
  ├─────────────────────────────────────────────────────────────┤
  │ /sdcard/Download  ▸ breadcrumbs ▸                            │
  │                                                               │
  │  [Folder Browser grid/list — existing FileManager internals] │
  │                                                               │
  │  Upload · Download · Delete · Rename · Preview               │  ← existing FileManager
  actions
  └─────────────────────────────────────────────────────────────┘
  
  When "Applications" tab is active, the same header/search/refresh stays, and the body
  swaps to AppManager's existing package list/filter/actions (Install APK, Export APK,
  Uninstall, Force Stop, Clear Cache, Clear Data, App Details) — all already implemented in
  useAppManager/AppManager.tsx, just re-hosted without its modal chrome (X close button,
  backdrop) since it's now a permanent page, not an overlay.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  5. Overview Page Layout
  
  New landing page shown when a device is selected from Devices/Dashboard (route: 'devices'
   → device drill-in, or a dedicated #/overview/:serial state):
  
  ┌─────────────────────────────────────────────────────────────┐
  │ 📱 Pixel 7 Pro                                    ● Online   │
  │ Android 14 · 192.168.1.5:5555 · WiFi                          │
  ├───────────────────────┬───────────────────────────────────────┤
  │ DEVICE INFO           │ HEALTH                                │
  │ Model, Serial,        │ Battery ▓▓▓▓▓▓▓░░ 77%                  │
  │ Android Ver, Conn.    │ Storage ▓▓▓▓▓░░░░ 62%                  │
  │ (existing DeviceStatus│ RAM     ▓▓▓▓▓▓░░░ 5.4/12GB              │
  │  data model)          │ Temp / CPU (if available)              │
  ├───────────────────────┴───────────────────────────────────────┤
  │ QUICK ACTIONS                                                  │
  │ [Explorer] [Install APK] [Screenshot] [Record] [Shell]         │
  │ [Logcat] [Wireless ADB] [Reboot]                                │
  ├─────────────────────────────────────────────────────────────┤
  │ RECENT ACTIVITY                                                │
  │ Screenshots (thumbnails) · Recordings · Installed APKs · Cmds  │
  └─────────────────────────────────────────────────────────────┘
  
  Data sources — all already exist, no new backend work required for Device Info/Health:
  
  - Device Info/Health → useDeviceStatus (same hook DeviceStatus.tsx/DevicesPage.tsx
   already call)
  - Quick Actions → same handlers already wired in App.tsx (onInstallApk,
  screenshot.capture, beginRecording, setIsLogcatOpen, navigate to Wireless ADB,
  runAction('reboot'))
  - Recent Activity → screenshot.history (already collected by useScreenshot) + a new
  lightweight useRecentActivity hook aggregating existing recording-output-dir listing and
  useAppManager's install log (currently install results are shown via notify() only and
  not retained — this is the one net-new piece of state, a small in-memory/localStorage
  ring buffer, not a new feature surface).
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  6. Migration Plan
  
  Phased, non-breaking, each phase independently shippable/testable:
  
  Phase 1 — Route/nav data model (no UI change yet)
  
  - Extend appRoutes.ts with group field and nested paths; update appRoutes.test.ts.
  - Add AppRouteGroupId and a APP_ROUTE_GROUPS map.
  - Verify existing flat routes still resolve (dashboard, settings etc. keep working) —
  pure additive change.
  
  Phase 2 — Sidebar grouping
  
  - Rewrite AppNavigation.tsx to render a collapsible tree from APP_ROUTE_GROUPS instead of
  the flat mainRoutes/toolItems/extraItems arrays.
  - Keep actions prop contract for now (buttons that open modals) so nothing else in
  App.tsx needs to change yet.
  
  Phase 3 — Explorer merge
  
  - Add embedded prop to AppManager (mirroring FileManager's existing embedded prop) so
  both can render chromeless.
  - Build ExplorerPage.tsx + ExplorerHeader/TabStrip shared components.
  - Wire route explorer-files/explorer-apps in App.tsx; keep old
  isFileManagerOpen/isAppManagerOpen modal state working in parallel during transition
  (both entry points can coexist temporarily), then remove the modal-trigger buttons from
  toolbars once Explorer is verified.
  
  Phase 4 — Control/Development/Monitoring groups
  
  - Add embedded presentation mode to LogcatViewer, KeymapController, MacroRecorder,
  CustomCommand, DeepLinkLauncher (same pattern as Phase 3).
  - Build MonitoringPage.tsx reusing StatCard/UsageBar extracted from DeviceStatus.tsx into
  shared src/components/ui/.
  - Build thin ShellPage.tsx wrapping the existing shell/log panel already used in
  Dashboard's bottom tabs.
  
  Phase 5 — Overview page + Recent Activity
  
  - Build OverviewPage.tsx using useDeviceStatus + existing action handlers.
  - Add minimal useRecentActivity hook (persist to localStorage like
  useScreenshot/useMacroRecorder already do).
  
  Phase 6 — Cleanup
  
  - Remove now-redundant modal triggers/backdrop code paths once their embedded
  counterparts are confirmed working (isAppManagerOpen, isFileManagerOpen state, etc. in
  App.tsx), or keep both if quick "peek" modals remain desirable from other pages (e.g.
  opening File Manager from a Devices-page card action could still deep-link into Explorer
  instead of a modal).
  - Delete/merge duplicated empty-state and header markup once extracted into
  EmptyState/WorkspaceHeader.
  
  Each phase: npm run lint && npm run build && npx vitest run as the gate, same as this
  session's prior changes.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  7. Reusable Components (to extract)
  
  ┌─────────────────────┬─────────────────────────────────┬────────────────────────────┐
  │ Component           │ Extracted from                  │ Currently duplicated in    │
  ├─────────────────────┼─────────────────────────────────┼────────────────────────────┤
  │ WorkspaceHeader     │ DevicesPage/SessionsPage/FileEx │ 4 near-identical <header>  │
  │                     │ plorerPage/RecordingsPage       │ blocks with title +        │
  │                     │ headers                         │ subtitle + action buttons  │
  ├─────────────────────┼─────────────────────────────────┼────────────────────────────┤
  │ TabStrip            │ DashboardLayout bottom tabs     │ 2 separate underline-tab   │
  │                     │ (logcat/shell/events) +         │ implementations            │
  │                     │ SettingsPage tabs               │                            │
  ├─────────────────────┼─────────────────────────────────┼────────────────────────────┤
  │ EmptyState          │ DevicesPage, SessionsPage,      │ 4+ nearly identical        │
  │                     │ RecordingsPage, ScreenshotsPage │ dashed-border empty states │
  │                     │ "no X" blocks                   │                            │
  ├─────────────────────┼─────────────────────────────────┼────────────────────────────┤
  │ StatCard / UsageBar │ DeviceStatus.tsx                │ Already reusable-shaped,   │
  │                     │                                 │ just needs to move to      │
  │                     │                                 │ src/components/ui/ so      │
  │                     │                                 │ OverviewPage/MonitoringPag │
  │                     │                                 │ e can both import it       │
  ├─────────────────────┼─────────────────────────────────┼────────────────────────────┤
  │ SlideOverDrawer     │ DevicesPage's Connection Tools  │ 4 copies of the same fixed │
  │                     │ drawer + SessionsPage's Session │ inset-0 ... flex           │
  │                     │ Settings drawer +               │ justify-end overlay +      │
  │                     │ DashboardLayout's Session       │ Escape-to-close useEffect  │
  │                     │ Settings/Inspector drawers      │                            │
  └─────────────────────┴─────────────────────────────────┴────────────────────────────┘
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  8. Recommended Folder Structure
  
  src/components/
    layout/                    NEW
      WorkspaceHeader.tsx
      TabStrip.tsx
      EmptyState.tsx
      SlideOverDrawer.tsx
  explorer/                  NEW (replaces standalone app-manager + file-manager entry
  points)
      ExplorerPage.tsx
      ExplorerHeader.tsx        (or reuse layout/WorkspaceHeader directly)
    monitoring/                NEW
      MonitoringPage.tsx
      PerformanceTab.tsx
      BatteryTab.tsx
      MemoryTab.tsx
      CpuTab.tsx
      NetworkTab.tsx           (wraps existing ConnectionHealth)
    overview/                  NEW
      OverviewPage.tsx
      RecentActivityPanel.tsx
    control/                   NEW (thin route wrappers)
      ControlPage.tsx
      AutomationTab.tsx
    development/               NEW (thin route wrappers)
      ShellPage.tsx
    app-manager/                unchanged, gains `embedded` prop
    file-manager/               unchanged (already has `embedded`)
    device-status/              unchanged, StatCard/UsageBar re-exported from ui/
    ...(all other existing folders unchanged)
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  9. Duplicated Components to Merge
  
  - AppManager + FileManager → hosted together in ExplorerPage (not merged into one file —
  kept as two components under one page, per your "two tabs, not two pages" requirement).
  Needs: add embedded?: boolean to AppManagerProps (currently only FileManager has it).
  - Four slide-over drawers (DevicesPage, SessionsPage, DashboardLayout ×2) → one
  SlideOverDrawer primitive.
  - Four empty-state blocks → one EmptyState primitive.
  - Two tab-strip implementations (DashboardLayout bottom tabs, SettingsPage tabs) → one
  TabStrip primitive.
  - DeviceStatus modal → its content (StatCard/UsageBar grid) is logically identical to
  what Monitoring/Overview need; the modal itself can be retired once Monitoring+Overview
  ship, rather than kept as a third place showing the same battery/storage/RAM numbers.
  - FileExplorerPage (an existing, currently-unrouted-looking page with hardcoded
  placeholder stats like "78%", "Pixel 9 Pro") appears to be a superseded/half-built
  earlier version of what Explorer should become — recommend retiring it in favor of the
  new ExplorerPage, reusing its SummaryStat/QuickAction visual pattern (which is good) but
  wired to real useDeviceStatus data instead of hardcoded strings.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  10. UX Improvements Without Changing Design Language
  
  - Grouped, collapsible sidebar sections instead of a flat 13-item list — same
  buttons/icons/colors, just organized (Android Studio/Knox pattern).
  - Tabs instead of modals for Explorer/Control/Development/Monitoring — same components,
  removes the "everything is a popup" feel that reads as a tool collection rather than a
  platform. Modals remain appropriate for truly transient actions (confirm dialogs, Add
  Device, Wireless Pairing wizard) — those stay as-is.
  - One Overview landing page per device gives a consistent "device home base" (matches
  Knox/Device Explorer mental model of select-device → see-everything-about-it → drill into
  specific tools).
  - Consistent header pattern (WorkspaceHeader) across Explorer/Monitoring/Device
  Management so every domain page has the same device-context + search + refresh
  affordances, reducing relearning cost between sections.
  - Breadcrumb-ready routing (group field on routes) sets up Dashboard > Explorer > Files
   style breadcrumbs later without further restructuring.
  - CPU/Temperature gap flagged, not fabricated: current DeviceStatus/useDeviceStatus
  backend (device_status.rs) exposes battery/storage/RAM/network but no CPU% or temperature
  — the plan places CpuTab as a real placeholder ("Not available on this backend yet")
  rather than inventing fake data, preserving trust; a note for future backend work
  (getprop//proc/stat parsing) rather than a UI deception.
  
  ─────────────────────────────────────────────────────────────────────────────────────────
  
  This is a plan only — no files were modified in this pass, since the ask was for
  architecture/route/component/migration documentation. Say go if you want me to start
  implementing Phase 1 (route data model) and Phase 2 (sidebar grouping) first, since those
  are the lowest-risk, foundational changes everything else builds on.