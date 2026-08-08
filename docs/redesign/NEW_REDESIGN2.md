# Mobile Device Studio — UI Redesign

## Reference Images
 
### Dashboard Design ใหม่
![Dashboard Redesign](./docs/redesign/images/image.png)
 
> ภาพเป็น Design Reference เท่านั้น ห้ามคัดลอกข้อมูลตัวอย่างในภาพมาเป็น mock data ให้เชื่อมกับ state, commands, event handlers และ data source เดิมของโปรเจกต์

---

## Role

คุณเป็น Senior UI/UX Designer และ Senior Frontend Engineer

งานของคุณคือปรับปรุง UI/UX ของโปรเจกต์ **Mobile Device Studio** ที่มีอยู่แล้ว ให้ดูทันสมัย เป็นมืออาชีพ ใช้งานง่าย และมีโครงสร้างคล้าย Desktop Developer Tool เช่น Android Studio, VS Code, Cursor, Linear และ Raycast

ช่วยวิเคราะห์และปรับปรุง UI ของโปรเจกต์ Mobile Device Studio ที่มีอยู่แล้ว

IMPORTANT:
- อย่า rewrite project ใหม่
- อย่าเปลี่ยน business logic ที่ทำงานอยู่
- อย่าเปลี่ยน ADB / scrcpy / device connection logic
- อย่า mock functionality ที่ปัจจุบันใช้งานได้จริง
- ให้ inspect codebase ปัจจุบันก่อน แล้วค่อย refactor UI จาก structure เดิม
- component ไหนมีอยู่แล้วให้ reuse/refactor ก่อนสร้างใหม่
- functionality เดิมทั้งหมดต้องยังใช้งานได้

เป้าหมาย:
ต้องการเปลี่ยน UI จากลักษณะ Device Utility Dashboard
ให้มีลักษณะเป็น "Mobile Device IDE / Mobile Device Studio"

ให้ใช้ภาพ reference ที่แนบมาเป็น Design Direction
ไม่จำเป็นต้อง pixel-perfect แต่ layout, hierarchy และ UX ควรใกล้เคียง

========================================
1. วิเคราะห์ของเดิมก่อน
========================================

ก่อนแก้ code ให้ตรวจสอบ:

- App structure
- Routing
- Layout components
- Sidebar
- Device management
- Active device/session state
- scrcpy integration
- ADB integration
- Logcat
- Shell
- File Explorer
- App Manager
- Screenshot / Recording
- Automation
- Script Manager
- Task Scheduler

จากนั้นสรุป:

1. Component ไหน reuse ได้
2. Component ไหนควร refactor
3. Component ไหนควรแยกใหม่
4. State ไหนเป็น shared state
5. จุดไหนถ้าแก้ UI แล้วเสี่ยงกระทบ functionality

ห้ามเริ่ม rewrite ก่อนวิเคราะห์ส่วนนี้

========================================
2. Navigation ใหม่
========================================

Desktop ไม่ต้องใช้ Bottom Navigation

ให้ใช้ Sidebar เป็น navigation หลัก

จัดกลุ่มประมาณ:

MAIN
- Dashboard
- Devices
- Sessions

TESTING
- Test Runs
- Test Cases
- Test Suites
- Automation

TOOLS
- App Manager
- File Explorer
- Shell Terminal
- Logcat Viewer
- Performance

SYSTEM
- Wireless ADB
- Settings

ถ้า feature บางตัวในรายการยังไม่มีจริง
ให้แสดงเฉพาะของที่มีอยู่ก่อน
อย่าสร้าง fake implementation

========================================
3. Workspace Tabs
========================================

เพิ่ม IDE-style workspace tabs ด้านบน

ตัวอย่าง:

[ Xiaomi 17 ● ] [ Pixel 9 × ] [ Test Run #142 × ] [ Shell × ] [+]

หนึ่ง tab สามารถ represent:

- Device Session
- Test Run
- Shell
- Logcat
- File Explorer

ต้องรองรับ active tab และ close tab

ออกแบบ architecture ให้สามารถรองรับ multiple devices ในอนาคต

========================================
4. Device Workspace
========================================

ให้ Device Screen เป็น primary content

Layout:

┌───────────────────────────────────────────────┐
│ Device Header                                │
├───────────────────────────────────────────────┤
│ Quick Actions                                │
├───────────────────────┬───────────────────────┤
│                       │ Control               │
│                       │ Inspector             │
│    DEVICE SCREEN      │ Settings              │
│                       │                       │
│                       │                       │
├───────────────────────┴───────────────────────┤
│ Logcat | Shell | Events | Test Runner         │
└───────────────────────────────────────────────┘

Device Screen ต้องใหญ่กว่าปัจจุบัน

ลด unused whitespace รอบ device

แต่ต้องรักษา aspect ratio ของ device screen

========================================
5. Device Header
========================================

ข้อมูลที่ใช้บ่อยให้รวมไว้ด้านบน

ตัวอย่าง:

Xiaomi 23078PND5G       ● Online

Android 16
USB
Battery 73%

856 × 1920
60 FPS

และ Quick Actions เช่น:

Screen
Install APK
Shell
File Explorer
Screenshot
More

หลีกเลี่ยงการแสดงข้อมูลเดียวกันซ้ำหลายตำแหน่ง

========================================
6. Quick Actions ต้อง Context-aware
========================================

Disconnected:

Connect
Wireless ADB
Pair
Device Info

Connected:

Screen
Install APK
Shell
Files
Screenshot
Restart

Session Running:

Screenshot
Record
Rotate
Fullscreen
Stop

ให้ derive actions จาก device/session state
ไม่ hardcode UI แยกหลายชุดถ้าไม่จำเป็น

========================================
7. Session Control
========================================

ลด settings ที่แสดงพร้อมกัน

Main panel ใช้ tabs:

CONTROL | INSPECTOR | SETTINGS

CONTROL แสดงเฉพาะค่าที่ใช้บ่อย เช่น:

Session
- Keep Screen On
- Stay Awake
- Auto Rotate
- Screen Timeout

Performance
- FPS Limit
- Bitrate

Audio
- Forward Audio
- Audio Codec

Advanced configuration ให้เปิดผ่าน:

Session Settings

อย่าเอา advanced settings ทั้งหมดมากองใน main screen

========================================
8. Bottom Workspace
========================================

ทำ bottom panel แบบ IDE:

LOGCAT | SHELL | EVENTS | TEST RUNNER

ต้อง resize/collapse ได้ถ้า architecture ปัจจุบันรองรับ

Logcat ควรมี:

- Level
- Search
- Pause
- Clear
- Filter

และรักษา functionality เดิม

========================================
9. Automation / Testing
========================================

ยกระดับ Automation จาก Extra Tool
ให้เป็น first-class feature

เตรียม UI architecture สำหรับ:

Test Runs
Test Cases
Test Suites
Automation

Test Run panel ตัวอย่าง:

Payment / Successful Payment

4 / 12 Steps
██████░░░░ 33%

✓ Reset App             0.8s
✓ Launch App            1.2s
✓ Login                 2.4s
→ Scan QR Code          Running
○ Select Machine        Pending
○ Select Package        Pending
○ Confirm Payment       Pending
○ Payment Success       Pending

[ Pause ] [ Stop ]

Status ที่ต้องรองรับ:

pending
running
passed
failed
skipped

ตอนนี้ถ้า Testing Engine ยังไม่มี
ให้ทำเฉพาะ reusable UI architecture
อย่าสร้าง fake test execution

========================================
10. Device Information
========================================

Device Info ไม่ควรแย่งพื้นที่ Device Screen

ข้อมูลสำคัญอยู่ Device Header

ข้อมูลละเอียด เช่น:

Model
Manufacturer
Serial
Android Version
SDK
ABI
Resolution
Density
IP
Bootloader
Security Patch
Uptime

ให้แสดงใน collapsible panel / drawer / secondary card

========================================
11. Visual Design
========================================

รักษา Dark Theme เดิม

Design direction:

- Modern Developer Tool
- IDE-like
- Dense แต่ไม่รก
- Professional
- ไม่ทำ card ซ้อน card มากเกินไป
- clear hierarchy
- consistent spacing
- subtle borders
- purple เป็น primary accent
- green = connected/success
- red = destructive/error
- yellow = warning

ลดความเด่นของ decorative UI
ให้ Device Screen / Test Status / Logs เป็นสิ่งเด่น

========================================
12. Responsive Desktop
========================================

รองรับอย่างน้อย:

1280px
1440px
1920px+

เมื่อพื้นที่ลด:

Right panel → collapsible
Device Info → drawer
Bottom logs → collapsible

Device Screen ต้องยัง usable

========================================
13. Refactor Rules
========================================

สำคัญมาก:

- ไม่สร้าง duplicate component
- ไม่ duplicate device state
- ไม่ duplicate scrcpy state
- ไม่ duplicate ADB state
- แยก UI state ออกจาก device/session state
- reusable components
- small components
- predictable state flow
- หลีกเลี่ยง giant page component
- หลีกเลี่ยง hardcoded device data
- หลีกเลี่ยง hardcoded test data ใน production path

========================================
14. วิธีดำเนินงาน
========================================

ทำเป็น Phase:

Phase 1
Inspect project + สรุป architecture ปัจจุบัน

Phase 2
เสนอ component/layout structure ใหม่
โดย mapping กับ component เดิม

Phase 3
Refactor shell:
- Sidebar
- Workspace Tabs
- Main Workspace
- Right Panel
- Bottom Panel

Phase 4
ย้าย Device Session UI เดิมเข้ามา
โดยรักษา functionality

Phase 5
ปรับ responsive behavior

Phase 6
เตรียม Automation/Test workspace

Phase 7
ตรวจ regression

หลังแต่ละ Phase:
- build
- lint/typecheck
- ตรวจ runtime errors
- ห้ามปล่อย broken state ไป Phase ถัดไป

========================================
15. ก่อนเริ่มแก้
========================================

ก่อนเขียน code ให้ตอบผมก่อนว่า:

1. Current architecture เป็นอย่างไร
2. Files/components ไหนจะถูกแก้
3. Component ไหนจะ reuse
4. Component ใหม่ที่ต้องเพิ่ม
5. State management จะได้รับผลกระทบหรือไม่
6. scrcpy/ADB integration จะรักษาไว้ยังไง
7. แผนการ migrate UI โดยไม่ทำ functionality เดิมพัง

จากนั้นค่อยเริ่ม implementation