# Multi-device Control — แผนปิดช่องว่าง

อัปเดตล่าสุด: 27 กันยายน 2569
สถานะเอกสาร: รอเริ่มงาน
ขอบเขต: Multi-device Mirror, Device Group, Batch Control, Quick Actions, Install APK / Send File, Wireless Scan, Text Distribute, Script, Timed Task, External API

## เป้าหมาย

ปิดช่องว่างที่พบจากการตรวจโค้ดจริงเทียบกับเช็คลิสต์ความสามารถของเครื่องมือกลุ่ม multi-device control (Panda / Total Control class) โดยเรียงตามความเสี่ยงก่อนความสวยงาม งานอันดับแรกคือกันคำสั่งยิงผิดเครื่อง ไม่ใช่การเพิ่มฟีเจอร์ใหม่

เอกสารนี้เป็น "แผนงาน" ไม่ใช่รายงานการตรวจ ส่วนสถานะที่ระบุมาจากการอ่านโค้ดในวันที่อัปเดต ไม่ใช่การประมาณ ทุกข้อจึงอ้างไฟล์และบรรทัดไว้ให้ตรวจซ้ำได้

แผนที่เกี่ยวข้องและไม่ทับซ้อนกับเอกสารนี้:

- `DEVICE_FARM_IMPLEMENTATION_PLAN.md` — registry, groups, health, batch fan-out (ฐานของงานนี้)
- `MOBILE_DEVICE_STUDIO_NEXT_FEATURES_PLAN.md` — broadcast/sync, auto-recovery
- `DATA_DRIVEN_AUTOMATION_PLAN.md` — data-driven Maestro batch runner
- `MOBILE_STUDIO_ROADMAP.md` — ดัชนี Module ระดับแอป

## ภาพรวมสถานะ

| # | หัวข้อ | สถานะ | งานที่ต้องทำ |
|---|--------|-------|--------------|
| 1 | Multi-device Mirror | 🟢 ครบ | ไม่มี (double-click expand เป็นของเสริม) |
| 2 | Device Group | 🟡 ครบแต่มีกับดัก | P0-1 |
| 3 | Batch Control | 🟢 รายงานผลต่อเครื่องครบ | P1-4 (cancel/progress) |
| 4 | Quick Actions | 🟡 confirm ไม่ครบ | P0-2 |
| 5 | Install APK / Send File | 🟡 ขาด flag และ path | P1-1, P1-2 |
| 6 | Wireless / Scan | 🟡 UI โฆษณาเกินจริง | P0-3, P1-5 |
| 7 | Text Distribute | 🟡 ASCII เท่านั้น | P1-3 |
| 8 | Script | 🟢 แข็งแรง | P2-3 (verify progress parser) |
| 9 | Timed Task | 🔴 ไม่มี engine | P2-1 |
| 10 | External API (WSAPI) | 🔴 ไม่มี | P2-2 |

## สถานะรายหัวข้อ (ฐานสำหรับแผน)

### 1. Multi-device Mirror — ครบ

- [x] Gate 2 ชั้น: default 4 สตรีม, เกิน 4 confirm, เกิน 9 confirm ครั้งที่สอง — `src/utils/multiStreamPolicy.ts:2`
- [x] ลด resolution/FPS/bitrate อัตโนมัติตามจำนวนสตรีม และ `Math.min` ทับ setting ผู้ใช้ — `src/components/embedded-workspace/DeviceGrid.tsx:96`
- [x] Start แบบ stagger 2 เครื่อง/350ms กันยิง adb พร้อมกัน
- [x] Auto start เครื่องใหม่ถึงโควตา 4 — `DeviceGrid.tsx:135`
- [x] Auto reconnect 3 ครั้งพร้อม state `reconnecting` — `src/hooks/useEmbeddedSession.ts:716`
- [x] ปิด mirror ไม่กระทบ ADB (ตัด ADB เป็นคำสั่งแยก)
- [ ] double-click เพื่อขยายเต็มจอใน grid (ตอนนี้ใช้ปุ่ม Maximize; Device Wall มี double-click อยู่แล้วที่ `DeviceWallCard.tsx:171`)

### 2. Device Group — ครบแต่มีกับดัก

- [x] สร้าง / แก้ชื่อ / ลบ (ลบมี confirm) และจำข้าม session ใน `localStorage`
- [x] Wireless และ USB อยู่ group เดียวกันได้ (เก็บเป็น serial ล้วน)
- [x] Group เป็น target ของ automation ได้ — `src/components/automation/AutomationTargetSelector.tsx`
- [ ] **กับดัก**: เมื่อไม่มี selection `targets` fallback เป็นทุกเครื่อง ไม่ใช่เครื่องใน group ที่กรอง — `src/hooks/useDeviceWorkspace.ts:152` → P0-1
- [ ] เลือก group แล้วยังต้องกด "Select visible" เอง — `src/components/pages/DeviceWallPage.tsx:399` → P0-1
- โดยดีไซน์: หนึ่งเครื่องอยู่ได้ group เดียว (`src/services/deviceGroupService.ts:164`) — ดู "ข้อจำกัดที่ยอมรับไว้"

### 3. Batch Control — ครบ

- [x] Runner กลาง bounded concurrency, ผลเรียงตามลำดับเดิม, แยก `success | failure | cancelled` — `src/utils/deviceBatchRunner.ts`
- [x] 1 เครื่อง fail ไม่ล้มทั้งชุด: มี summary + ตารางต่อเครื่องพร้อม stderr — `src/components/device-workspace/DeviceWorkspace.tsx:801`
- [x] นับ "สั่งผ่านแต่ device ตอบ fail" แยกจาก exception — `src/App.tsx:814`
- [ ] cancel และ progress ต่อเครื่องระหว่างทำงาน → P1-4

### 4. Quick Actions

- [x] Dashboard quick actions ผูก active device; แถบ batch ผูก selected devices (แยกกันชัด)
- [x] confirm สำหรับ reboot, shell fan-out, ลบ group
- [ ] **uninstall / clear_data ใน Device Wall ยิงทันทีไม่มี confirm** — `src/components/pages/DeviceWallPage.tsx:176` → P0-2

### 5. Install APK / Send File

- [x] Fan-out หลายเครื่อง (push concurrency 2, pull แยกโฟลเดอร์ต่อ serial) — `src/services/deviceBatchOperations.ts`
- [x] Batch push แก้ path ปลายทางได้ (default `/sdcard/Download`)
- [x] Drag & drop ที่ Local APK Toolkit — `src/components/pages/LocalApkToolkitPage.tsx:49`
- [ ] ไม่มี `-r` / `-d` / `-g`; `adb install` ถูกเรียกเปล่า — `src-tauri/src/commands.rs:882` → P1-1
- [ ] Quick Send File hardcode `/sdcard/Download/` — `src-tauri/src/commands.rs:853` → P1-2
- [ ] ไม่มี progress ทั้งรายเครื่องและรวม → P1-4
- [ ] Install จาก Local APK ตัดที่ 9 เครื่องแบบเงียบ ๆ — `src/App.tsx:909` (แจ้งใน toast ท้ายงานเท่านั้น) → P1-1

### 6. Wireless / Scan Wi-Fi

- [x] mDNS เป็นหลัก + fallback sweep /24 port 5555 (400ms, 64 concurrent) — `src-tauri/src/commands.rs:526`, `:590`
- [x] จำ IP เดิมสองที่: `scrcpy_history` และ device registry
- [x] หาพอร์ตใหม่ผ่าน mDNS และ retry `disconnect → connect` เมื่อเจอ ghost state — `src/hooks/useScrcpy.ts:742`
- [ ] **Toggle "Auto-reconnect ... when the app starts" ไม่ทำงานตามข้อความ** — จริง ๆ คุมแค่ tracker refresh loop (`src/hooks/useScrcpy.ts:463`) ไม่มีใครเรียก `connectDevice` ตอน startup; ข้อความอยู่ที่ `src/components/pages/PairDevicePage.tsx:344` → P0-3
- [ ] USB และ Wi-Fi ของเครื่องเดียวกันขึ้นเป็นสองรายการ (แยก type จาก `:` ใน serial) — `src/types/deviceRegistry.ts:132` → P1-5

### 7. Text Distribute

- [x] Broadcast หลายเครื่องผ่าน `adb shell input text` (ASCII allowlist, space → `%s`, จำกัด 1000 bytes) — `src-tauri/src/macro_player.rs:75`
- [x] เครื่องเดียวผ่าน scrcpy control รองรับ UTF-8 จริง (`TYPE_INJECT_TEXT` + `set_clipboard`) — `src-tauri/src/embed_session.rs:158`, `:1787`
- [ ] ไทย / emoji / newline บน broadcast ยัง error `unsupported character` → P1-3

### 8. Script — แข็งแรง

- [x] ADB command allowlist, macro tap/swipe/keyevent, sequence, Maestro `repeat`/`retry`
- [x] Smart tap ข้ามเครื่องด้วย selector จาก UI hierarchy แล้ว fallback สเกลพิกัด — `src/hooks/useDeviceWorkspace.ts:464`
- [x] ตัวแปรจาก dataset (`single`/`cross`/`zip`/`lookup`/`sequentialFallback`) — `src/utils/automationRunStrategy.ts`
- [x] รันข้ามเครื่อง concurrency 2, cancel ได้ทั้งฝั่ง JS และ Rust (`src-tauri/src/maestro.rs:483`)
- [x] Log/artifact/timing ต่อเครื่อง เก็บ 100 run ล่าสุด — `src/services/automationBatchRunService.ts:199`
- [ ] Per-step progress parser ยังไม่เคย verify กับ Maestro CLI จริง (คอมเมนต์เตือนไว้เอง) — `src/hooks/useMaestroRunProgress.ts:21` → P2-3

### 9. Timed Task — ยังไม่มี engine

- [x] Type พร้อมแล้ว: `ScheduledTaskDefinition` + trigger `once | interval | cron` + `ExecutionTargetRef` — `src/types/testingCatalog.ts:75`
- [x] Catalog service มีช่อง `scheduledTasks` รองรับ CRUD — `src/services/testingCatalogService.ts:24`
- [ ] ไม่มีตัวรันตามเวลา และเมนู `/task-scheduler` ปัจจุบันแสดง Test Session ไม่ใช่ scheduler — `src/components/pages/TaskSchedulerPage.tsx` → P2-1

### 10. External API (WSAPI) — ยังไม่มี

- [x] Companion protocol: LAN TCP + USB bulk, auth ด้วย QR token, capability negotiation — `src-tauri/src/companion.rs` (private protocol ระหว่าง desktop กับแอปเราเอง ไม่ใช่ API สาธารณะ)
- [x] SimDeck เป็น REST *client* ยิงออก ไม่ใช่ server — `src-tauri/src/simdeck.rs`
- [ ] ไม่มี HTTP/WS ให้ระบบอื่นสั่งงาน → P2-2

## P0 — ความปลอดภัยของคำสั่งหลายเครื่อง

เกณฑ์รวมของเฟสนี้: ผู้ใช้ต้องไม่สามารถยิงคำสั่งเปลี่ยนสถานะเครื่องไปยังเครื่องที่ตัวเองมองไม่เห็นบนหน้าจอได้

### P0-1 — `targets` ต้องเคารพ group filter

- ปัญหา: กรอง group ไว้ แต่ยังไม่ติ๊กเครื่อง แล้วกด Install / Reboot / Shell → ยิงทุกเครื่องในระบบ
- แก้: เปลี่ยน `targets` ให้ fallback เป็น "รายการที่มองเห็นหลังกรอง" ไม่ใช่ `devices` ทั้งชุด และเมื่อเลือก group ให้ตั้ง selection เป็นเครื่องใน group นั้นทันที (ยังแก้รายตัวได้)
- ไฟล์: `src/hooks/useDeviceWorkspace.ts:152` (รับรายการ visible เข้ามาแทนการเดา), `src/components/pages/DeviceWallPage.tsx:129`, `src/components/device-workspace/DeviceWorkspace.tsx:155`
- เกณฑ์ตรวจรับ:
  - [ ] กรอง group ที่มี 2 เครื่องจาก 10 เครื่อง ไม่ติ๊กอะไร กด batch action → มีผลกับ 2 เครื่อง
  - [ ] แถบยืนยันและ toast แสดงจำนวนเครื่องที่ตรงกับที่เห็นจริง
  - [ ] Unit test ครอบ fallback: ไม่มี selection + มี filter, มี selection ข้าม filter, filter ว่างเปล่า

### P0-2 — confirm ให้ครบทุก destructive action

- แก้: `uninstall` และ `clear_data` ใน Device Wall ต้องผ่าน `confirmAction` แบบเดียวกับ reboot (โชว์ชื่อ package + จำนวนเครื่อง + รายชื่อ serial)
- ไฟล์: `src/components/pages/DeviceWallPage.tsx:176`
- เกณฑ์ตรวจรับ:
  - [ ] uninstall / clear_data ยิงได้เฉพาะหลังยืนยัน และยกเลิกได้จริง
  - [ ] ข้อความยืนยันระบุ package และจำนวนเครื่อง
  - [ ] ทบทวนรายการ action ที่เหลือหนึ่งรอบ ให้ destructive ทุกตัวมี confirm (reboot, power, uninstall, clear_data, shell, ลบ group)

### P0-3 — Auto-reconnect: ทำให้ตรงกับที่เขียนไว้

- ปัญหา: ข้อความสัญญาว่าจะต่อเครื่อง Wi-Fi ที่รู้จักตอนเปิดแอป แต่โค้ดไม่มีขั้นนั้น
- แก้ (เลือกทำจริง): ตอน startup ถ้า toggle เปิด ให้ลอง `adb connect` กับรายการ Wi-Fi ใน registry/history แบบ bounded concurrency + timeout ต่อรายการ, ลองครั้งเดียวต่อการเปิดแอป, เขียนผลลง log panel และไม่ retry วนซ้ำ
- ไฟล์: `src/hooks/useScrcpy.ts:463` (แยก concern ออกจาก tracker loop), `src/components/pages/PairDevicePage.tsx:344`, `src/components/pages/WirelessAdbPage.tsx:101`
- เกณฑ์ตรวจรับ:
  - [ ] เปิดแอปโดยมีเครื่อง Wi-Fi เดิมออนไลน์ → ต่อกลับเองภายในเวลาที่กำหนด
  - [ ] เครื่องที่ไม่อยู่แล้ว → ล้มเหลวเงียบ ๆ มี log ไม่มี retry storm และไม่บล็อก UI
  - [ ] ปิด toggle → ไม่มี `adb connect` อัตโนมัติเลย
  - [ ] ถ้าเลือกไม่ทำ ต้องแก้ข้อความ UI ให้ตรงความจริงแทน (ห้ามปล่อยไว้)

## P1 — คุณภาพงานประจำวัน

### P1-1 — Install APK options

- เพิ่ม `-r` (reinstall), `-d` (downgrade), `-g` (grant permissions) เป็นตัวเลือกจาก UI ส่งต่อไป backend และจำค่าไว้ใช้ครั้งถัดไป
- ทำให้ลิมิต 9 เครื่องชัดเจน: แจ้งก่อนรัน ไม่ใช่รู้ตอนจบ หรือยกลิมิตแล้วใช้ concurrency คุมโหลด
- ไฟล์: `src-tauri/src/commands.rs:882`, `src/hooks/useDeviceWorkspace.ts:325`, `src/App.tsx:909`
- เกณฑ์ตรวจรับ:
  - [ ] ติดตั้งทับ APK เดิมสำเร็จเมื่อเปิด `-r`
  - [ ] ผลลัพธ์ต่อเครื่องยังเก็บ stderr ของ adb ไว้ครบเมื่อ fail (เช่น `INSTALL_FAILED_VERSION_DOWNGRADE`)
  - [ ] Rust test ครอบการประกอบ argument ตาม flag ที่เลือก

### P1-2 — Send File: เลือกปลายทางได้

- เปลี่ยน `push_file` ให้รับ remote dir (validate เหมือน `fm_push`) และให้ quick action เลือก/จำ path ล่าสุด
- เพิ่ม drag & drop ลงพื้นที่ batch push ให้เท่ากับ Local APK Toolkit
- ไฟล์: `src-tauri/src/commands.rs:853`, `src/hooks/useScrcpy.ts:881`, `src/components/device-workspace/DeviceWorkspace.tsx:706`
- เกณฑ์ตรวจรับ:
  - [ ] ส่งไฟล์ไป path ที่กำหนดเองได้ และ path ที่ไม่ถูกต้องถูกปฏิเสธพร้อมเหตุผล
  - [ ] ลากไฟล์ลงพื้นที่ push แล้วได้ path เดียวกับการกด Browse

### P1-3 — Text Distribute ภาษาไทย / Unicode

- ต่อ broadcast เข้ากับ `send_embedded_text` ของ session ที่ live อยู่แล้ว (UTF-8 จริง) และคงเส้นทาง `adb shell input text` เป็น fallback เมื่อไม่มี session
- แจ้งให้ชัดว่าเครื่องไหนได้ผ่านช่องทางใด และเครื่องที่ไม่มี session ทำอะไรได้/ไม่ได้
- ไฟล์: `src/hooks/useDeviceWorkspace.ts:380` (`broadcastText`), `src/hooks/useEmbeddedSession.ts:815`, `src-tauri/src/macro_player.rs:75`
- เกณฑ์ตรวจรับ:
  - [ ] เลือก 10 เครื่องที่ mirror อยู่ พิมพ์ข้อความไทย → ทุกเครื่องได้ข้อความถูกต้อง
  - [ ] `WX0007` ยังทำงานเหมือนเดิมทั้งเครื่องที่มีและไม่มี session
  - [ ] เครื่องที่ไม่มี session และข้อความเป็นไทย → รายงานเหตุผลชัดเจน ไม่ใช่ error ดิบ

### P1-4 — Cancel และ progress ต่อเครื่องของงาน batch

- runner รองรับ `AbortSignal` แล้ว เหลือเดินสายจาก UI: ปุ่ม Stop + สถานะต่อเครื่อง (`pending / running / done / failed / cancelled`) ระหว่างทำงาน
- ไฟล์: `src/services/deviceBatchOperations.ts` (รับ signal), `src/utils/deviceBatchRunner.ts` (callback ต่อเครื่อง), `src/components/device-workspace/DeviceWorkspace.tsx:285`
- เกณฑ์ตรวจรับ:
  - [ ] กด Stop กลาง push 10 เครื่อง → เครื่องที่ยังไม่เริ่มถูกรายงานเป็น `cancelled` เครื่องที่เสร็จแล้วยังเป็น `success`
  - [ ] เห็นสถานะเปลี่ยนรายเครื่องระหว่างทำงาน ไม่ต้องรอจบ
  - [ ] Progress ของ push/pull ระบุขั้นตอนได้ระดับไฟล์ต่อเครื่อง (ถ้าทำ byte-level ไม่ได้ ให้บอกตรง ๆ ว่าเป็นสถานะไม่ใช่เปอร์เซ็นต์)

### P1-5 — รวมเครื่องเดียวกันที่มาทั้ง USB และ Wi-Fi

- อ่าน `ro.serialno` (หรือ hardware id ที่เชื่อถือได้) เก็บใน registry แล้วจับคู่รายการ USB/Wi-Fi เป็นเครื่องเดียว แสดง transport ที่ใช้ได้ทั้งสอง และ dedupe ก่อนส่งเข้า batch
- ไฟล์: `src/types/deviceRegistry.ts:132`, `src/hooks/useDeviceRegistry.ts`, `src/services/deviceStatusService.ts`
- เกณฑ์ตรวจรับ:
  - [ ] เครื่องที่ต่อทั้ง USB และ Wi-Fi ขึ้นแถวเดียว
  - [ ] Batch action ไม่ยิงซ้ำสองครั้งไปเครื่องเดียวกัน
  - [ ] ถอด USB แล้วรายการยังอยู่ผ่าน Wi-Fi โดยไม่เสีย group ที่ตั้งไว้

## P2 — ความสามารถใหม่

### P2-1 — Timed Task engine

- ใช้ type ที่มีอยู่แล้ว ไม่สร้างโครงใหม่: `ScheduledTaskDefinition` ผูกกับ automation / script / test-case / suite และ target เป็นเครื่องหรือ group
- ตัวรันควรอยู่ฝั่ง Rust เพื่อไม่ผูกกับหน้าที่เปิดอยู่ ส่ง event กลับมาให้ UI (ข้อจำกัดที่ต้องเขียนให้ชัด: ทำงานเฉพาะระหว่างแอปเปิด)
- นโยบายเมื่อถึงเวลาแล้วเครื่อง offline ต้องเลือกได้ต่อ task: `skip` (บันทึกว่าข้าม), `retry` (จำนวนครั้ง + backoff), `queue` (รอจนออนไลน์ภายในกรอบเวลาที่กำหนด แล้ว expire)
- บันทึกผลเป็น test-run ใน catalog ให้ย้อนดูได้เหมือน run ปกติ
- ไฟล์: `src/types/testingCatalog.ts:75`, `src/services/testingCatalogService.ts`, `src/components/pages/TaskSchedulerPage.tsx`, `src-tauri/src/` (module ใหม่)
- เกณฑ์ตรวจรับ:
  - [ ] ตั้ง interval/cron/once แล้วรันได้ตรงเวลา และ enable/disable ได้
  - [ ] เครื่อง offline → พฤติกรรมตรงกับนโยบายที่เลือก และเห็นเหตุผลใน run record
  - [ ] ปิดแอปแล้วเปิดใหม่ → task ยังอยู่ ไม่รันย้อนหลังซ้ำโดยไม่ได้สั่ง
  - [ ] เมนู `/task-scheduler` ชี้ไปที่ scheduler จริง และย้าย Test Session ไปที่ที่เหมาะสม

### P2-2 — Local Control API (แนวคิดแบบ WSAPI)

- เป้าหมาย: ให้ระบบอื่น (รวม Mobile Studio ส่วนอื่น) สั่งงานฟลีตได้โดยไม่ต้องผ่าน UI
- รูปแบบที่เสนอ: HTTP + WebSocket bind `127.0.0.1` เท่านั้น, ปิดเป็นค่าเริ่มต้น, เปิดจาก Settings พร้อม token, มี allowlist ของ action
- ขอบเขตรุ่นแรก: list devices/groups, start/stop mirror, install APK, push/pull, shell (ผ่าน allowlist เดิม), run automation/flow, subscribe progress event
- ใช้ service layer ที่มีอยู่เป็นแกน (`runDeviceBatch`, `automationBatchRunService`, `deviceBatchOperations`) ไม่เขียน logic ซ้ำ — ชั้นใหม่เป็น adapter เท่านั้น
- เกณฑ์ตรวจรับ:
  - [ ] ปิดอยู่โดยค่าเริ่มต้น และปฏิเสธ request ที่ไม่มี token
  - [ ] ไม่ bind interface ภายนอก
  - [ ] ทุก action ที่เปิดผ่าน API มี audit log ระบุ source, target, ผลลัพธ์
  - [ ] Destructive action ผ่าน API ต้องประกาศไว้ชัดว่าไม่มี confirm dialog และควบคุมด้วย allowlist

### P2-3 — Verify Maestro per-step progress

- ตรวจ regex จับ `✓ / ✗ / PASS / FAIL` กับ output ของ `maestro --no-ansi test` เวอร์ชันจริงที่ทีมใช้ แล้วแก้ให้ตรง หรือเปลี่ยนไปอ่านรูปแบบผลลัพธ์ที่เสถียรกว่าถ้ามี
- ไฟล์: `src/hooks/useMaestroRunProgress.ts:21`
- เกณฑ์ตรวจรับ:
  - [ ] มีตัวอย่าง output จริงเก็บเป็น fixture ในเทสต์
  - [ ] ลบคอมเมนต์ "ASSUMPTION — UNVERIFIED" ออกได้อย่างสุจริต

## ข้อจำกัดที่ยอมรับไว้ (ไม่ทำในรอบนี้)

- **หนึ่งเครื่องอยู่ได้ group เดียว** — เป็นการตัดสินใจโดยตั้งใจ (`deviceGroupService.ts:164`) ถ้าจะเปลี่ยนเป็น many-to-many ต้องแก้ทั้ง document format, migration, `groupOf()` และ UI filter พร้อมกัน จึงแยกเป็นงานก้อนใหม่ ไม่ผสมเข้าเฟสนี้
- **Subnet sweep มองแค่ port 5555** — ครอบเคสส่วนใหญ่ เครื่องที่ใช้พอร์ตสุ่มยังพึ่ง mDNS ตามเดิม การสแกนหลายพอร์ตแลกกับเวลาสแกนที่ยาวขึ้นมาก
- **Progress ระดับ byte ของ adb push** — `adb push` ไม่คืนความคืบหน้าแบบ stream ในเส้นทางที่ใช้อยู่ P1-4 จึงตั้งเป้าที่สถานะต่อเครื่อง ไม่ใช่เปอร์เซ็นต์
- **double-click ขยายใน grid** — ของเสริม ทำพร้อมงาน UI รอบถัดไปได้

## หมายเหตุ

- ทุก `file:line` ในเอกสารนี้อ้างสถานะโค้ดวันที่ 27 กันยายน 2569 ถ้าโค้ดขยับ ให้ยึดชื่อฟังก์ชันเป็นหลัก
- เกณฑ์ตรวจรับเขียนให้ทดสอบได้จริงบนเครื่องจริง ไม่ใช่เช็คลิสต์ความรู้สึก งานที่ต้องใช้เครื่องหลายตัวให้ใช้ขั้นตอนใน `MULTI_DEVICE_PHYSICAL_VALIDATION.md`
