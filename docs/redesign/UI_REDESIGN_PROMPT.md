# Mobile Device Studio — UI Redesign

## Reference Images

### UI ปัจจุบัน
![Current UI](./docs/ui-reference/current-ui.png)

### Dashboard Design ใหม่
![Dashboard Redesign](./docs/ui-reference/dashboard-redesign.png)

### มุมมองทุกเมนู
![All Pages Redesign](./docs/ui-reference/all-pages-redesign.png)

> ภาพเป็น Design Reference เท่านั้น ห้ามคัดลอกข้อมูลตัวอย่างในภาพมาเป็น mock data ให้เชื่อมกับ state, commands, event handlers และ data source เดิมของโปรเจกต์

---

## Role

คุณเป็น Senior UI/UX Designer และ Senior Frontend Engineer

งานของคุณคือปรับปรุง UI/UX ของโปรเจกต์ **Mobile Device Studio** ที่มีอยู่แล้ว ให้ดูทันสมัย เป็นมืออาชีพ ใช้งานง่าย และมีโครงสร้างคล้าย Desktop Developer Tool เช่น Android Studio, VS Code, Cursor, Linear และ Raycast

## ข้อห้ามสำคัญ

- ห้ามสร้างโปรเจกต์ใหม่
- ห้ามเปลี่ยน business logic เดิมโดยไม่จำเป็น
- ห้ามลบ feature หรือเมนูที่มีอยู่
- ห้ามแก้ backend, scrcpy command, ADB logic หรือ device connection logic
- ต้องใช้ component, state management, route และโครงสร้างเดิมให้มากที่สุด
- ให้เน้น refactor เฉพาะ UI, layout, component structure และ design system
- หากจำเป็นต้องเปลี่ยนโครงสร้างไฟล์ ให้ทำแบบ incremental และอธิบายเหตุผลก่อน
- ทุกขั้นตอนต้องมั่นใจว่าโปรเจกต์ยัง run ได้
- ห้ามแทนข้อมูลจริงด้วย mock data หากโปรเจกต์มี data source หรือ state เดิมอยู่แล้ว
- หากยังต่อข้อมูลจริงไม่ได้ ให้คง interface เดิมและสร้าง adapter ชั่วคราว โดยห้ามลบ implementation เดิม

## ก่อนแก้ Code

1. สำรวจโครงสร้างโปรเจกต์ทั้งหมด
2. ตรวจสอบ framework, styling library และ component library ที่ใช้อยู่
3. หา route และหน้าทั้งหมดที่มี
4. หา component ที่สามารถ reuse ได้
5. หา duplicated UI และ duplicated styles
6. หา logic ที่ผูกอยู่กับ UI ซึ่งต้องระวังไม่ให้พัง
7. สรุปแผนการ refactor ก่อนเริ่มแก้ code

## เป้าหมายของ Design ใหม่

1. ทำให้ Device Preview เป็นจุดเด่นที่สุดของหน้าหลัก
2. ลดจำนวน card และ border ที่ไม่จำเป็น
3. จัดลำดับความสำคัญของข้อมูลใหม่
4. ทำให้แต่ละเมนูมี layout และ design language เดียวกัน
5. แยก Navigation, Workspace และ Inspector ให้ชัดเจน
6. รองรับหน้าจอขนาดต่าง ๆ
7. Sidebar และ Inspector ต้องสามารถยุบหรือขยายได้
8. ลดความแน่นของข้อมูล แต่ยังคงเข้าถึงทุก feature ได้
9. ใช้ spacing, typography, radius และ color อย่างสม่ำเสมอ
10. UI ต้องดูเหมือน Desktop Application ไม่ใช่หน้าเว็บไซต์ทั่วไป

## App Shell

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar                                                      │
├──────────────┬────────────────────────────────┬──────────────┤
│ Sidebar      │ Main Workspace                 │ Inspector    │
│ Navigation   │ Content ของแต่ละหน้า           │ Contextual   │
│              │                                │ Settings     │
├──────────────┴────────────────────────────────┴──────────────┤
│ Optional Bottom Panel: Logs / Terminal / Events              │
└──────────────────────────────────────────────────────────────┘
```

### Top Bar

- ชื่อโปรแกรม
- Engine status
- Selected device
- Connection status
- Refresh
- Settings
- User menu หรือ About
- ไม่ควรมีความสูงมากเกินไป

### Left Sidebar

#### Main

- Dashboard
- Devices
- Sessions
- Screenshots
- Recordings
- File Explorer
- Wireless ADB

#### Tools

- App Manager
- Shell Terminal
- Logcat Viewer
- Performance
- Input Control

#### Extra

- Automation
- Script Manager
- Task Scheduler
- Settings

ข้อกำหนด:

- ยุบเป็น icon-only ได้
- แสดง active route ชัดเจน
- รองรับ tooltip ตอนยุบ
- เมนูที่ยังไม่มีหน้าสมบูรณ์ให้คงไว้ แต่แสดง Coming Soon ได้
- ห้ามลบเมนูเดิม

### Main Workspace

- เป็นพื้นที่หลักของแต่ละหน้า
- ต้องใช้พื้นที่มากที่สุด
- ไม่ควรครอบด้วย card ขนาดใหญ่อีกชั้นโดยไม่จำเป็น
- ใช้ section header, toolbar และ content area แทน card ซ้อนหลายชั้น

### Right Inspector

- แสดงเฉพาะ setting ที่เกี่ยวข้องกับ context ปัจจุบัน
- ยุบได้
- ไม่ต้องแสดงทุก setting ตลอดเวลา
- Dashboard: Session Behavior
- Screenshots: Capture Settings
- Recordings: Recording Settings
- Devices: Device Details
- File Explorer: File Properties

### Bottom Panel

ใช้สำหรับ Logcat, Shell, Events และ Activity logs

- เปิด/ปิดได้
- ปรับความสูงได้
- ใช้ tab สลับเนื้อหา
- ไม่ควรแสดงตลอดเวลาหากไม่มีข้อมูลสำคัญ

## Design System

สร้าง design tokens กลาง ห้ามกำหนดค่าซ้ำกระจายตาม component

ต้องมี:

- Color tokens
- Background levels
- Border colors
- Text colors
- Accent colors
- Success, Warning, Error, Info
- Spacing scale
- Typography scale
- Border radius
- Shadow
- Transition duration
- Z-index levels

### Color Direction

```text
App background:       #080B12
Sidebar:              #0D111B
Surface:              #111622
Elevated surface:     #171D2B
Text primary:         #F5F7FA
Text secondary:       #AAB1C0
Text muted:           #6F7787
Primary purple:       #7C4DFF
Purple hover:         #9068FF
Success:              #25D695
Warning:              #F5B942
Error:                #FF5C72
Info:                 #4D9FFF
```

หลักการ:

- ใช้ purple เป็น accent ไม่ใช่พื้นหลังของทุก component
- ลดการใช้ gradient
- gradient ใช้เฉพาะ CTA หรือ highlight สำคัญ
- ลด glow effect
- ใช้ border แบบ subtle
- ลด card ซ้อน card
- radius ประมาณ 8–12 px
- spacing หลักใช้ 4, 8, 12, 16, 24, 32
- ปุ่ม primary ต้องเด่น แต่ไม่ใหญ่เกินเนื้อหา

## หน้าที่ต้องปรับ

### 1. Dashboard

- Device Preview ต้องใหญ่และอยู่กลาง
- Quick Actions อยู่ด้านบน
- Device Info อยู่ด้านซ้ายหรือเป็น collapsible panel
- Control Center อยู่ใกล้ preview
- Session settings อยู่ Inspector ด้านขวา
- Connected Devices อยู่ด้านล่าง
- Logcat / Shell / Events อยู่ Bottom Panel
- เปลี่ยน “Start Mission” เป็นคำที่ตรงกับ function จริง เช่น Start Mirroring, Start Session หรือ Connect & Mirror

Quick Actions:

- Screen
- Camera
- Desktop
- Install APK
- Shell
- Power

Device controls:

- Zoom
- Rotate
- Home
- Back
- Recent apps
- Screenshot
- Record

Inspector:

- Stay Awake
- Keep Active
- Screen Off
- Forward Audio
- Audio Codec
- Always on Top
- Full Screen
- Borderless
- Record Feed
- Record Path

### 2. Devices

- ใช้ list หรือ table
- แสดง Name, Model, Android version, Connection type, Battery, Resolution และ Status
- Actions: View, Control, Files, Shell, Disconnect
- รองรับ card/list view หากโครงสร้างเดิมรองรับ
- Empty state ต้องแนะนำ USB และ Wireless

### 3. Sessions

- แสดง history เป็น table
- Columns: Device, Start time, Duration, Capture mode, Status, Actions
- มี search และ filter
- มี empty state

### 4. Screenshots

- Gallery grid
- Search
- Filter ตาม device และ date
- Sort newest/oldest
- Preview
- Open, Copy, Show in folder, Delete
- Multi-select

### 5. Recordings

- Table หรือ list
- Thumbnail, Filename, Device, Duration, Size, Created date
- Play, reveal in folder, rename, delete
- Recording settings อยู่ Inspector

### 6. File Explorer

- Two-pane layout
- ซ้าย folder tree ขวา file list
- Breadcrumb
- Upload, download, create folder, rename, delete
- Drag and drop
- Loading และ progress state

### 7. Wireless ADB

- Connect new device
- Paired devices
- Connection history
- IP Address, Port และ Pairing code หากรองรับ
- Validation
- แสดง connection status และ error ที่เข้าใจง่าย

### 8. App Manager

- Icon, App name, Package name, Version, Size
- Launch, Stop, Clear data, Uninstall, Export APK หากรองรับ
- Search และ filter system/user apps

### 9. Shell Terminal

- Terminal เป็นพื้นที่หลัก
- รองรับหลาย tab หากโครงสร้างเดิมรองรับ
- Command history
- Clear terminal
- Copy output
- Connection status
- ห้ามเปลี่ยน command execution logic เดิม

### 10. Logcat Viewer

- Severity filters: Verbose, Debug, Info, Warning, Error
- Search, Pause, Clear, Auto scroll, Export
- ใช้สีระดับ log อย่างระมัดระวัง

### 11. Settings

แบ่ง tab:

- General
- Appearance
- Devices
- Recording
- Shortcuts
- Advanced
- About

Reuse form components เดียวกัน เช่น Toggle, Select, Input, Path picker, Slider และ Keybinding input

## Reusable Components

- AppShell
- TopBar
- Sidebar
- SidebarSection
- SidebarItem
- InspectorPanel
- BottomPanel
- PageHeader
- PageToolbar
- StatusBadge
- EmptyState
- DeviceCard
- DeviceRow
- DevicePreview
- DeviceToolbar
- QuickActionButton
- SettingRow
- ToggleField
- SelectField
- PathField
- DataTable
- SearchInput
- FilterBar
- ConfirmDialog
- ContextMenu
- Toast
- LoadingState
- ErrorState

## UX Requirements

- ทุก action มี hover, active, disabled และ loading state
- การลบข้อมูลต้องมี confirmation
- แสดง toast เมื่อสำเร็จหรือล้มเหลว
- tooltip สำหรับ icon ที่ไม่มี label
- รองรับ keyboard navigation
- focus state ต้องมองเห็นได้
- หลีกเลี่ยงตัวพิมพ์ใหญ่ทั้งหมดมากเกินไป
- ใช้ชื่อ action ที่สื่อความหมายตรง
- status ต้องมีข้อความหรือ icon ไม่ใช้สีเพียงอย่างเดียว
- Advanced settings ซ่อนไว้ใน Advanced หรือ More Settings
- ห้ามแสดง control ซ้ำหลายตำแหน่งโดยไม่มีเหตุผล

## Responsive Desktop Behavior

Desktop ใหญ่:

- Sidebar 240–260px
- Inspector 300–340px
- Main Workspace ใช้พื้นที่ที่เหลือ

Desktop เล็ก:

- Sidebar ยุบเป็น icon
- Inspector เปิดเป็น drawer
- Bottom Panel ย่อหรือซ่อนได้

ไม่ต้องทำ mobile responsive แบบเว็บไซต์ แต่ต้องรองรับ window resize อย่างเหมาะสม

## Implementation Phases

### Phase 1: Audit

- แสดง route และหน้าทั้งหมด
- แสดง component ที่มีอยู่
- แสดง duplicated code
- ระบุจุดเสี่ยงที่อาจกระทบ logic

### Phase 2: Design System

- สร้าง tokens
- ปรับ typography
- ปรับ base components
- ปรับ button, input, select, switch และ panel

### Phase 3: App Shell

- Sidebar
- Top Bar
- Main Workspace
- Inspector
- Bottom Panel
- เชื่อมกับ route เดิม

### Phase 4: Dashboard

- ปรับ Dashboard ก่อน
- ทดสอบ device connection และ preview
- ตรวจสอบ action เดิมยังทำงานครบ

### Phase 5: Other Pages

1. Devices
2. Sessions
3. Screenshots
4. Recordings
5. File Explorer
6. Wireless ADB
7. App Manager
8. Shell Terminal
9. Logcat Viewer
10. Settings

### Phase 6: Cleanup

- ลบ duplicated style
- ลบ component ที่ไม่ได้ใช้
- ห้ามลบ logic ที่ยังไม่แน่ใจ
- ตรวจสอบ accessibility
- ตรวจสอบ resize
- ตรวจสอบ build และ lint

## วิธีการทำงาน

ก่อนแก้แต่ละ phase:

1. บอกไฟล์ที่จะเปลี่ยน
2. บอกเหตุผล
3. บอกผลกระทบ
4. แก้ code
5. run lint/type-check/test/build
6. สรุปว่าแก้อะไร
7. ระบุสิ่งที่ยังไม่ได้ทำ

ห้ามแก้ทั้งโปรเจกต์ในครั้งเดียว ให้ทำทีละ phase และรอ review หลังจบแต่ละ phase

## Acceptance Criteria

- ทุก route เดิมยังเข้าได้
- ทุก feature เดิมยังอยู่
- Device detection ยังทำงาน
- USB และ Wireless ADB ยังทำงาน
- Screen mirroring ยังทำงาน
- Screenshot และ Recording ยังทำงาน
- File push/install APK ยังทำงาน
- Shell และ Logcat ยังทำงาน
- UI ทุกหน้ามี design language เดียวกัน
- Sidebar ยุบได้
- Inspector ยุบได้
- resize แล้ว layout ไม่พัง
- ไม่มี horizontal overflow โดยไม่จำเป็น
- ไม่มี duplicated component ที่ควร reuse
- ไม่มี hardcoded color กระจายตามไฟล์
- lint, type-check และ build ผ่าน

## งานรอบแรก

ทำเฉพาะ Phase 1–4 และหน้า Dashboard เท่านั้น

- อย่าเพิ่งแก้หน้าอื่น
- Sidebar ต้องแสดงเมนูทั้งหมดที่มีอยู่
- reuse event handlers, state, commands และ device logic เดิม
- เปลี่ยนเฉพาะ layout และ presentation layer

หลังทำเสร็จให้แสดง:

- รายชื่อไฟล์ที่แก้
- component ที่สร้างใหม่
- component เดิมที่ reuse
- logic เดิมที่ไม่ได้แตะ
- screenshot หรือคำอธิบาย layout ใหม่
- ผล lint, type-check และ build

## เริ่มต้นงาน

1. วิเคราะห์โครงสร้างโปรเจกต์ปัจจุบัน
2. สรุป route และ component ที่มี
3. เสนอ migration plan โดยยึดโครงสร้างเดิม
4. ห้ามแก้ code จนกว่าจะสรุปแผนเสร็จ
