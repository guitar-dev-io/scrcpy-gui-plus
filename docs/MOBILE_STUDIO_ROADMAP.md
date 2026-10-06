# Mobile Studio Roadmap

อัปเดตล่าสุด: 25 กันยายน 2569
สถานะเอกสาร: กำลังพัฒนา
ขอบเขต: แผนที่ระดับ Module ทั้งแอป (scrcpy-gui-plus → Mobile Studio) — เอกสารนี้เป็น "ดัชนี" ที่ชี้ไปยังแผนละเอียดที่มีอยู่แล้วในแต่ละเรื่อง ไม่ใช่แผนละเอียดใหม่

## เป้าหมาย

จัดกลุ่มความสามารถของแอปให้เป็น 6 Module ที่ขอบเขตชัดเจน ไม่ทับซ้อนกัน เพื่อใช้เป็นแผนที่ตัดสินใจว่าฟีเจอร์ใหม่ควรอยู่ตรงไหน และเห็นภาพรวมว่า Module ไหนยังขาดอะไรจริง ๆ

**หมายเหตุสำคัญ**: ก่อนเขียนเอกสารนี้ พบว่ามีแผนละเอียดอยู่แล้วใน `docs/` ครอบคลุมส่วนใหญ่ของ 6 Module นี้:

- `DEVICE_FARM_IMPLEMENTATION_PLAN.md` — multi-device registry, groups, health, batch actions, automation fan-out (Module 1, 3, 4)
- `MOBILE_DEVICE_STUDIO_NEXT_FEATURES_PLAN.md` — auto-recovery, multi-device broadcast/sync, visual compare (Module 2, 4, 5, 6)
- `Mobile_Device_Studio_APK_Toolkit_Plan.md` — APK inspector/compare/backup (Module 3)
- `DATA_DRIVEN_AUTOMATION_PLAN.md` — data-driven Maestro batch runner (Module 4)
- `mobile-companion-app-plan.md` — แนวคิดสำรอง ควบคุมมือถือโดยไม่พึ่ง ADB (แนวทางอนาคตของ Module 2)
- `MULTI_DEVICE_PHYSICAL_VALIDATION.md` — ขั้นตอนตรวจสอบ multi-stream บนเครื่องจริง
- `MULTI_DEVICE_PARITY_PLAN.md` — แผนปิดช่องว่าง multi-device control จากการตรวจโค้ดจริง: group/batch safety, install options, Unicode broadcast, cancel/progress, timed task, local control API (Module 1, 2, 3, 4)

สถานะที่ระบุด้านล่างอ้างอิงจากเอกสารเหล่านี้ + Tauri command จริงใน `src-tauri/src/lib.rs` ไม่ใช่การประมาณ

## ภาพรวมสถานะ

| # | Module | สถานะ |
|---|--------|-------|
| 1 | Device Fleet Management | 🟢 ครบเกือบทั้งหมด — reservation/lock ถูกตัดออกจาก scope โดยตั้งใจ ไม่ใช่ของที่ขาด |
| 2 | Remote Device Control | 🟢 ครบสมบูรณ์ — รวม multi-device broadcast/sync แล้ว |
| 3 | App Deployment | 🟢 ครบสำหรับ Android รวม multi-device fan-out; iOS ยังติดตั้งเครื่องจริงไม่ได้ |
| 4 | Test Automation & Evidence | 🟡 แข็งแรงมาก (Maestro + multi-device parallel + visual regression) แต่ไม่มี Appium |
| 5 | Device Recovery | 🟢 Implementation เสร็จแล้ว — เหลือแค่ QA บนฮาร์ดแวร์จริง |
| 6 | Debugging Tools | 🟢 ครบเกือบทั้งหมด รวม network/IP ใน health data แล้ว |

## Module 1 — Device Fleet Management

เป้าหมาย: ดูว่าเครื่องไหน Online/Offline, รุ่น, OS, Battery, Storage, Serial, App ที่ติดตั้ง และจัดการเครื่องจำนวนมากไม่ให้ชนกัน

มีแล้ว (ดูรายละเอียดใน `DEVICE_FARM_IMPLEMENTATION_PLAN.md` Phase 1-2, 6):
- [x] Device registry keyed ด้วย serial พร้อม `firstSeen`/`lastSeen`/connection type/IP
- [x] Structured state: `device`, `offline`, `unauthorized`, `disconnected`
- [x] Devices Overview: filter All/Online/Busy/Warning/Offline, search, grid/list, multi-select
- [x] Health snapshot: battery level + temperature, storage, connection/IP, resolution, Android version, memory, uptime, charging, screen state
- [x] Configurable Device Groups (create/rename/delete/assign) แทน fixed enum เดิม
- [x] Health refresh แบบ staggered + bounded concurrency + TTL, หยุด poll เมื่อซ่อนหน้าจอ
- [x] App inventory ต่อเครื่อง: `app_manager::list_packages`, `get_package_info`
- [x] Dashboard/Device Detail รวมสถานะไว้ที่เดียว (`dashboard`, `device-status`, `devices` components)

ตัดออกจาก scope โดยตั้งใจ (ระบุชัดใน `DEVICE_FARM_IMPLEMENTATION_PLAN.md` หัวข้อ "Explicitly out of scope"):
- [ ] ระบบจอง/ล็อกเครื่อง (reservation service), organizations, tenants, RBAC, billing
- [ ] Cloud device farm / control plane หลายภูมิภาค

เหตุผล: แอปนี้ออกแบบเป็นเครื่องมือ local-first สำหรับทีมเล็ก (5-30 เครื่อง) ไม่ใช่ cloud device farm แบบ BrowserStack ถ้าอนาคตต้องรองรับหลายทีมใช้ device pool เดียวกันพร้อมกันจริง ๆ ค่อยเปิดเป็นการตัดสินใจใหม่ ไม่ใช่งานที่ค้างอยู่

## Module 2 — Remote Device Control

เป้าหมาย: ดูหน้าจอและควบคุมมือถือจากคอม เช่น Tap, Swipe, Keyboard, Clipboard, Rotate, Screenshot และ Recording

มีแล้ว (เครื่องเดียว):
- [x] scrcpy lifecycle + embedded mirror/session, touch/key/text input, screenshot, recording
- [x] Clipboard history component (`clipboard-history`)
- [x] Macro record/playback (`macro_player`)
- [x] iOS mirror และ Simulator control (`ios`, `simdeck`)

มีแล้ว (หลายเครื่องพร้อมกัน — `MOBILE_DEVICE_STUDIO_NEXT_FEATURES_PLAN.md` Phase 2-4):
- [x] Broadcast Home/Back/Recent/Power/Volume/Rotate/app actions/text ไปหลายเครื่องพร้อมกัน พร้อมผล success/failure/latency ต่อเครื่อง
- [x] Relative tap/swipe/long-press ที่แปลงพิกัดตาม resolution/orientation ของแต่ละเครื่องเป้าหมาย
- [x] Smart element broadcast (จับคู่ resource-id/content-desc/text ก่อน fallback เป็นพิกัด)

มีแล้ว — ควบคุมมือถือโดยไม่พึ่ง ADB/USB (`src-tauri/src/companion.rs` + `android-companion/`):
- [x] QR/LAN pairing + USB accessory (AOA), hello/capabilities handshake, over raw length-prefixed-JSON-over-TCP (ไม่ใช่ WebSocket ตามที่ `mobile-companion-app-plan.md` เคยเสนอไว้ — ของจริงที่ shipped ใช้โปรโตคอลที่ง่ายกว่า)
- [x] Persistent Agent device id, heartbeat telemetry (battery/wifi/screen), Trusted Studios list, และ bridge เข้า `RegisteredDevice`/Device Wall (ดู `docs/Device Registration.md`)
- [ ] Concurrent multi-Agent-device connections — `CompanionState` ปัจจุบันรองรับ 1 active connection ต่อครั้ง (เพียงพอกับการใช้งานจริงตอนนี้); รองรับหลายเครื่องพร้อมกันเป็นงานต่อยอดแยกที่ยังไม่เริ่ม

Module นี้สมบูรณ์ที่สุดและถูกขยายไปไกลกว่าคำจำกัดความเดิมแล้ว (จากควบคุมเครื่องเดียว → broadcast หลายเครื่อง)

## Module 3 — App Deployment

เป้าหมาย: Upload APK/IPA แล้วเลือกติดตั้งลงเครื่องเดียวหรือหลายเครื่อง รวมถึง Install / Uninstall / Clear Data / Restart App

มีแล้ว (Android, เครื่องเดียวและหลายเครื่อง — `DEVICE_FARM_IMPLEMENTATION_PLAN.md` Phase 5):
- [x] Install/uninstall/clear data/restart app ทั้งเครื่องเดียวและ fan-out หลายเครื่อง (Current/Selected/Group)
- [x] Push/pull file และ shell-command fan-out หลายเครื่องพร้อมผลลัพธ์แยกต่อเครื่อง
- [x] Reboot fan-out และการยืนยันก่อนทำ action ที่ทำลายข้อมูล
- [x] Bounded local batch runner (ไม่ใช่ unbounded `Promise.all`) พร้อม summary สำเร็จ/ล้มเหลว
- [x] APK analysis/extract/compare/backup/split (`apk_analyzer`, `apk_toolkit`, `apk_backup`, `apk_archive`) ตามแผนใน `Mobile_Device_Studio_APK_Toolkit_Plan.md`

ยังไม่มี — gap จริง:
- [ ] ติดตั้ง IPA ลงเครื่อง iOS จริง — `ios` module ปัจจุบันมีแค่ `check_ios_support`, `get_ios_devices`, `install_pymobiledevice3`, `start/stop_ios_mirror` ไม่มี install command; `simdeck` ก็เป็น Simulator เท่านั้น ไม่ใช่เครื่องจริง

งานถัดไปที่แนะนำ: ถ้าต้องรองรับ iOS deployment เครื่องจริง ต้องตัดสินใจก่อนว่าจะใช้ `pymobiledevice3` (ที่มี dependency อยู่แล้ว) ขยาย หรือใช้เครื่องมืออื่น เพราะ iOS signing/provisioning ซับซ้อนกว่า Android มาก

## Module 4 — Test Automation & Evidence

เป้าหมาย: รัน Appium, Maestro, ADB หรือ Test Script กับหลาย Device/OS และรัน Parallel Testing พร้อมเก็บ Pass/Fail, Logcat, Screenshot, Video, Crash Log

มีแล้ว:
- [x] Maestro flow lifecycle เต็มรูปแบบ (`maestro::*`)
- [x] Data-driven batch runner ต่อแถวข้อมูล (Excel/CSV/TSV/JSON) — cross join, lookup, filter, retry/pause/resume/checkpoint, เขียนผลกลับพร้อม backup (ดู `DATA_DRIVEN_AUTOMATION_PLAN.md`) — ปัจจุบันรันทีละแถวบน **เครื่องปัจจุบันเครื่องเดียว**
- [x] **Multi-device parallel Maestro runs** — รัน flow เดียวกันกับ Current/Selected/Group พร้อมกัน ใช้ 2 local workers, cancel ได้โดยไม่เสียผลลัพธ์ที่เสร็จแล้ว, เก็บ parent/child run history ต่อ serial พร้อม logs/screenshots/recordings/reports (ดู `DEVICE_FARM_IMPLEMENTATION_PLAN.md` Phase 7)
- [x] **Visual regression testing** ในตัวระบบ automation — capture ทุกเครื่อง, เทียบกับ baseline, overlay/diff/similarity score, ignore regions, แนบผลเข้ากับผล automation (ดู `MOBILE_DEVICE_STUDIO_NEXT_FEATURES_PLAN.md` Phase 5-9)
- [x] Bug report ที่รวม evidence: `bug_report::create_bug_report`, diagnostic bundle

ยังไม่มี — gap จริง:
- [ ] **Appium** — ไม่มี module หรือ command เกี่ยวข้องเลยในโค้ดปัจจุบัน มีแต่ Maestro
- [ ] ยังไม่ยืนยันว่า "data-driven batch (หลายแถวข้อมูล)" กับ "multi-device parallel fan-out" ทำงานร่วมกันได้ในตอนนี้ — ปัจจุบันดูเหมือนเป็นสองระบบคนละแกน (แถวข้อมูล vs. เครื่อง) ควรตรวจโค้ดจริงก่อนถือว่าเป็น gap หรือ non-issue

งานถัดไปที่แนะนำ: ตัดสินใจก่อนว่า Appium จำเป็นจริงหรือ Maestro ครอบคลุมพอ เพราะเพิ่ม Appium หมายถึงต้องมี Appium server lifecycle management ใหม่ทั้งชุด (ต่างจาก Maestro ที่เป็น CLI binary ตรง ๆ) — ถ้าไม่มีความต้องการเจาะจงจาก use case จริง แนะนำไม่ทำ

## Module 5 — Device Recovery

เป้าหมาย: ตรวจจับ ADB หลุด, scrcpy หลุด หรือ Device Offline แล้ว reconnect/restart ให้อัตโนมัติ

มีแล้ว — Implementation เสร็จสมบูรณ์แล้ว (ดู `MOBILE_DEVICE_STUDIO_NEXT_FEATURES_PLAN.md` Phase 1):
- [x] Normalized connection/recovery state (connecting/reconnecting/error/offline/unauthorized) ใช้ร่วมกันทุกหน้าจอ
- [x] Bounded recovery policy พร้อม retry delay ที่ตั้งค่าได้ (500ms/1s/2s) แยก isolate ต่อเครื่อง
- [x] Native event-driven device tracking (`adb track-devices`) พร้อม fallback แบบ polling
- [x] Auto-recover เมื่อ embedded screen หลุดโดยไม่ตั้งใจ (แยกแยะจากกรณีผู้ใช้สั่งหยุดเอง)
- [x] Resume recovery อัตโนมัติเมื่อ serial เดิมกลับมาหลัง USB/Wireless หลุด
- [x] Centralized shutdown ของทุก process registry (scrcpy, embedded, recording, logcat, iOS, Maestro, companion, auto-capture) ตอนปิดหน้าต่างหลัก
- [x] Recovery diagnostics และ diagnostic bundle สำหรับตรวจสอบย้อนหลัง (Phase 10)

เหลือ:
- [ ] **QA บนฮาร์ดแวร์จริง** — สถานะเอกสารต้นทางระบุ "Implementation complete; available-hardware QA pending" คือโค้ด/ตรรกะเขียนและมี unit test ครบแล้ว แต่ยังไม่ได้ยืนยันกับสถานการณ์ USB หลุดจริง/scrcpy crash จริงบนอุปกรณ์จริงครบทุกเคส

Module นี้ **ไม่ใช่ช่องว่างที่ต้องเริ่มใหม่** อย่างที่ประเมินไว้ตอนแรกจากการดูแค่ Rust command list — งานที่เหลือคือ QA ไม่ใช่ implementation

## Module 6 — Debugging Tools

เป้าหมาย: เปิด Logcat, ADB Shell, File Explorer, Package Inspector, Current Activity/Foreground App และข้อมูล Network

มีแล้ว:
- [x] Logcat viewer, ADB Shell/terminal, File Explorer เต็มรูปแบบ, Package Inspector
- [x] Current Activity/Foreground app (`maestro::get_foreground_app_package`, `test_session::get_device_info`)
- [x] ข้อมูล Network/IP — รวมอยู่ใน health snapshot ของ Module 1 อยู่แล้ว (`connection/IP` ตาม `DEVICE_FARM_IMPLEMENTATION_PLAN.md` Phase 6) ไม่จำเป็นต้องแยก command ใหม่
- [x] Command palette (Cmd/Ctrl+K), activity timeline, diagnostic bundle (Phase 10 ของ NEXT_FEATURES plan)

ไม่มี gap ที่ระบุได้ชัดเจนตอนนี้

## ลำดับความสำคัญที่แนะนำ (หลังแก้ไขจากการตรวจสอบเอกสารจริง)

1. **Module 5 — QA บนฮาร์ดแวร์จริง** สำหรับ recovery และ multi-stream (4/9 เครื่องพร้อมกัน ตาม `MULTI_DEVICE_PHYSICAL_VALIDATION.md`) — โค้ดเสร็จแล้ว เหลือแค่พิสูจน์กับของจริง ทำได้เร็วและความเสี่ยงต่ำสุด
2. **Module 4 — ตรวจว่า data-driven batch + multi-device fan-out ทำงานร่วมกันได้ไหม** ก่อนตัดสินใจว่าต้องพัฒนาเพิ่มหรือไม่
3. **Module 4 — ตัดสินใจเรื่อง Appium** เป็นการตัดสินใจ scope ไม่ใช่งานที่ต้องเริ่มทันที
4. **Module 3 — iOS physical deployment** ถ้ามี use case จริงจาก QA/dev team ที่ทดสอบ iOS เครื่องจริง
5. **Module 2 — Companion app ที่ไม่พึ่ง ADB** เป็นแนวทางอนาคตระยะยาว ยังไม่เร่งด่วน

## หมายเหตุ

- เอกสารนี้เป็นภาพรวมระดับ Module ที่ชี้ไปยังแผนละเอียดที่มีอยู่แล้ว — อย่าคัดลอกรายละเอียด phase มาไว้ซ้ำที่นี่ ให้แก้ที่เอกสารต้นทางแล้วอัปเดตแค่สถานะสรุปตรงนี้
- ถ้าจะเริ่มงานใน Module ไหนจริงจัง ให้อ่านเอกสารต้นทางของ Module นั้นก่อนเขียนแผนใหม่ซ้ำ (บทเรียนจากการเขียนฉบับแรกของเอกสารนี้ที่พลาดไปเพราะดูแค่ `lib.rs` โดยไม่เช็ค `docs/` ก่อน)
