# QR Studio Refactor – Checklist (ตรวจสอบแบบ read-only)

## สรุปคำตอบ
งาน refactor ตาม brief **ยังไม่ได้ทำเป็นส่วนใหญ่** โค้ดปัจจุบันยังเป็น QR Studio เวอร์ชันแรก (หน้าเดียว Create + Live Preview + Library) ซึ่ง commit แล้วใน `2218bef`/`35f0016`
- `git status` สะอาด (0 ไฟล์ uncommitted), `git diff --stat` ว่าง → ไม่มีงาน refactor ค้างใน working tree
- `git log -15`: HEAD `39a35dc` (device wall) ไม่เกี่ยวกับ QR Studio; ไม่มี commit refactor
- Test: `npx vitest run QrStudioPage.test.tsx qrStudioService.test.ts` → 2 files, 8 tests ผ่าน. `tsc --noEmit` exit 0. `npm run build` (tsc && vite build) สำเร็จ
- ผ่านเฉพาะฟีเจอร์เดิม ไม่ได้ครอบคลุมรายการ refactor

สถานะรวม: DONE 2 / PARTIAL 7 / NOT DONE 10 (จาก 19 ข้อ)

## Checklist
| # | รายการ | สถานะ | หลักฐาน |
|---|---|---|---|
| 1 | 5 หมวด Create/Templates/Device Actions/Tools/Library (แสดงทีละหมวด) | NOT DONE | `QrStudioPage.tsx` เป็นหน้าเดียว section Create + Library ต่อกัน ไม่มี tab/หมวด |
| 2 | Header + device selector, คง shell | NOT DONE | มี header (ปุ่ม Dashboard, ตัวนับ Saved/Links) แต่ไม่มี device selector; `App.tsx:1987,2002,2005` ซ่อน AppNavigation/Footer/WorkspaceTabBar เมื่อ `activeRoute==='qr-studio'` (ขัดกับข้อกำหนดให้คง shell) |
| 3 | สไตล์ dark navy + coral-red | PARTIAL | ใช้พื้น `#0d1725`/`#132031` และสี accent `#ff4f57` (`panelClass`, `accent`) แต่ไม่ได้เทียบ reference (`refs/Screenshot…png`) ไม่มี screenshot ยืนยัน |
| 4 | Library: search/filter/sort/grid-list/multi-select/bulk/pagination | PARTIAL | มี search (ชื่อ+content+type) และ type filter (`filteredRecords`) และ "Load more" (`pageLimit`); ไม่มี sort, grid/list toggle, multi-select, bulk actions, virtualization |
| 5 | Folders (All/Uncategorized/custom/Favorites/Recent/Trash, CRUD, move) | NOT DONE | `QrRecord` ไม่มี field folder; ไม่มี UI โฟลเดอร์; ลบเป็น hard delete (`remove`) ไม่มี Trash |
| 6 | Tags | NOT DONE | ไม่มี tag ใน `types/qrStudio.ts` และใน UI |
| 7 | QR cards | PARTIAL | มี thumbnail, ชื่อ, type badge, updated time (`relativeDate`), favorite (`toggleFavorite`), Download PNG, Copy, เมนู Edit/Duplicate/Download SVG/Delete. ไม่มี checkbox, Preview, Move |
| 8 | Details sidebar | NOT DONE | ไม่มี component/ state selection/ highlight |
| 9 | localStorage + migration | PARTIAL | `loadQrRecords`/`saveQrRecords` key `scrcpy-gui-plus:qr-studio:v1` กรอง record เสีย + merge `DEFAULT_QR_STYLE`; ไม่มี versioning/migration ไปสคีมาใหม่ (folders/tags/templates/notes) และไม่มี test migration |
| 10 | Create (12 types, single/bulk, design, validation, PNG/SVG, save) | PARTIAL | มี single/bulk (`parseMultiQrInput`), fg/bg/EC/size, live preview (debounce 180ms), contrast check (`colorContrast`), PNG/SVG (`downloadPng`/`downloadSvg`), save. `QrContentType` มีเพียง 5 ชนิด (url,text,wifi,contact,deep-link) ขาด App Link/Email/Phone/SMS/Location/Event/Custom; ไม่มี form เฉพาะชนิด (Wi-Fi ฯลฯ) |
| 11 | Templates (style presets) | NOT DONE | ไม่มีโค้ด preset |
| 12 | Device Actions (Send/Open on Device, Capture & Decode, deep link test) | NOT DONE | หน้า QR ไม่เรียกใช้ device/ADB; `launchDeepLink` มีใน `deepLinkService.ts` แต่ไม่ได้ import; ปุ่ม "Test" (`runTest`) เปิดแค่ http(s) ในเบราว์เซอร์ |
| 13 | Tools (Deep Link Builder, Wi-Fi generator, decoder, quality checker) | PARTIAL | มีเฉพาะ contrast checker แบบง่าย; ไม่มี builder/Wi-Fi generator/decoder |
| 14 | Overlay policy (portal, collision, focus trap/restore, z-index audit) | NOT DONE | เมนูการ์ดเป็น `absolute` ใน card (`role="menu"`, `z-20`) เสี่ยงโดน clip; มี Escape ปิดเมนู (`useEffect` keydown) แต่ไม่มี portal/focus trap/focus restore/collision; ไม่มี shared overlay layer; ใช้ `window.confirm` สำหรับลบ; มี `--z-drawer` ใช้แค่ toast |
| 15 | ทุก control มี handler | PARTIAL | control ที่มีอยู่ทำงานจริง (ตาม test/โค้ด) แต่ "Customize" แค่ `click()` color input; ข้อนี้ยังประเมินไม่ได้เต็มเพราะ UI ใหม่ยังไม่มี |
| 16 | Responsive 5 ขนาด + zoom | NOT DONE | มี breakpoint class (`xl:grid-cols`, `auto-fill`) แต่ไม่มีหลักฐานการทดสอบ/ screenshot ที่ขนาดเหล่านี้ |
| 17 | Automated tests | PARTIAL | `QrStudioPage.test.tsx` 5 เทส (create+persist, bulk, cancel edit, back to dashboard, contrast warning); `qrStudioService.test.ts` 3 เทส. ไม่ครอบคลุม folders/tags/templates/sort/bulk/overlay/device actions/migration |
| 18 | รัน build/test | DONE | ผลจริงในรอบนี้: vitest 8/8 ผ่าน, `tsc --noEmit` ผ่าน, `npm run build` สำเร็จ (ไม่พบหลักฐานว่ามีการรันในงาน refactor เพราะไม่มี commit) |
| 19 | Screenshot/visual verification | NOT DONE | ไม่มี artifact ของ QR Studio; มีแค่ `refs/Screenshot 2569-09-27 at 13.05.09.png` (reference), `image_qr.png`, `device_image_qr.png` (ไม่ใช่ผลตรวจ) |

(DONE: ข้อ 18 พร้อมข้อที่ทำงานเดิมใช้ได้ ส่วนข้อ 1,2,5,6,8,11,12,14,16,19 = NOT DONE)

## สิ่งที่ยังเหลือ (สรุป)
1. ขยาย data model: `QrContentType` 12 ชนิด, folderId, tags, notes, trashedAt, templates + schema version และ migration จาก v1
2. โครงหน้าใหม่ 5 หมวด + header/device selector และตัดสินใจคง shell (ลบเงื่อนไขซ่อนใน `App.tsx`)
3. Library: sort, grid/list, multi-select/bulk, folders/tags/Trash, details sidebar, pagination/virtualization
4. Device Actions และ Tools (ใช้ `launchDeepLink` + คำสั่ง Tauri ใหม่สำหรับ send/capture; decoder)
5. Overlay layer กลาง (portal, collision, focus trap/restore) แทนเมนู absolute และ `window.confirm`
6. เพิ่มเทสต์ครอบคลุมทุก flow, ตรวจ responsive 5 ขนาด + zoom และเก็บ screenshot

## ข้อจำกัดของการตรวจ
ไม่ได้เปิดแอปจริง/ไม่ได้ดู visual เทียบ reference; ข้อ 3, 15, 16 ตัดสินจากโค้ดเท่านั้น
