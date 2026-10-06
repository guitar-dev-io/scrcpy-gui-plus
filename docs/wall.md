ช่วยตรวจสอบโค้ดโปรเจกต์ Mobile Studio ปัจจุบันก่อน แล้วเพิ่มหน้า **Device Wall** สำหรับดูหน้าจอ Android หลายเครื่องพร้อมกัน

เป้าหมาย:
สร้างหน้า Device Wall ที่เน้น Monitoring หลาย Device แบบ Device Farm ไม่ใช่หน้าควบคุมเครื่องเดียว

ก่อนเริ่ม:

1. Inspect architecture, routes, device state, ADB/scrcpy integration และ UI components ที่มีอยู่ก่อน
2. ห้ามสร้างระบบ device connection ซ้ำ ถ้ามีของเดิมให้ reuse
3. ห้ามกระทบ Live Control / Device Screen เดิม
4. รักษา design system และ dark theme ปัจจุบัน
5. แยก component ให้สามารถ reuse ได้

## Device Wall

เพิ่มเมนู:
`Devices > Device Wall`

หน้า Device Wall ต้องมี:

* แสดง Device ทั้งหมดเป็น Grid
* แต่ละ card มี live screen preview
* Device name
* Model
* Android version
* Serial/Device ID แบบย่อ
* Online / Busy / Offline status
* FPS indicator
* Connection status เช่น ADB / scrcpy
* Selected state
* hover state
* loading/reconnecting state

ตัวอย่าง layout:

```text
Device Wall

All Devices (24)     ● 18 Online   ● 4 Busy   ○ 2 Offline

[ Search Device ] [ Status Filter ] [ Grid Size ]

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Pixel 8  │ │ S24      │ │ Xiaomi   │ │ OPPO     │
│ ● Online │ │ ● Online │ │ ● Busy   │ │ ● Online │
│          │ │          │ │          │ │          │
│  SCREEN  │ │  SCREEN  │ │  SCREEN  │ │  SCREEN  │
│ PREVIEW  │ │ PREVIEW  │ │ PREVIEW  │ │ PREVIEW  │
│          │ │          │ │          │ │          │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

## Live Preview

Device Wall ต้องสามารถแสดง stream หลายเครื่องพร้อมกัน

แต่ต้อง optimize performance:

* Device ที่อยู่บน Wall ใช้ preview FPS ต่ำ เช่น 5–15 FPS
* ไม่ควรเปิด full-quality stream ทุกเครื่อง
* Device ที่อยู่นอก viewport สามารถ pause/reduce FPS ได้
* Device ที่ Offline ห้ามพยายามสร้าง stream ซ้ำตลอดเวลา
* รองรับ reconnect เมื่อ device กลับมา online
* อย่าสร้าง scrcpy process ซ้ำ ถ้ามี session อยู่แล้ว

ออกแบบ architecture ให้ภายหลังสามารถรองรับประมาณ 20–50 devices ได้

## Interaction

Single click:

* select device

Double click:

* เปิด Live Control ของ device นั้น

Context menu / `...`:

* Open Live Control
* Screenshot
* Start App
* Stop App
* Reboot
* ADB Shell
* Device Info

ตอนนี้ยังไม่ต้องยัด action จำนวนมากลง card

Device Wall ต้องดูสะอาดและเน้นหน้าจอของ device เป็นหลัก

## Multi Select

รองรับ checkbox / multi-select

เมื่อเลือกมากกว่า 1 device ให้แสดง bottom action bar:

```text
3 Devices Selected

[ Install App ]
[ Start App ]
[ Stop App ]
[ Clear Data ]
[ Reboot ]
[ Deselect ]
```

ให้ใช้ command/service เดิมที่มีอยู่ ถ้ามี

## Filters

เพิ่ม:

* All
* Online
* Busy
* Offline

Search:

* device name
* model
* serial

สามารถเพิ่ม group filter หาก architecture ปัจจุบันรองรับ

เช่น:

* Samsung
* Pixel
* Xiaomi
* OPPO
* Custom Group

## Grid

รองรับอย่างน้อย:

* Compact
* Normal
* Large

หรือ responsive grid ตามขนาดหน้าต่าง

Card ต้องรักษา aspect ratio ของจอมือถือ และไม่ทำให้หน้า dashboard สูง/กว้างผิดปกติ

## Important Architecture

แยกประมาณ:

```text
DeviceWallPage
DeviceWallToolbar
DeviceGrid
DevicePreviewCard
DeviceStreamPreview
DeviceStatusBadge
MultiDeviceActionBar
```

ชื่อจริงสามารถปรับตาม architecture ของโปรเจกต์เดิมได้

อย่าบังคับใช้ structure นี้หากของเดิมมี pattern ที่ดีกว่า

## Stream lifecycle

ตรวจสอบให้ดีเรื่อง:

* start preview
* pause preview
* resume preview
* stop preview
* device disconnect
* device reconnect
* component unmount
* switching page
* application shutdown

ต้องไม่เหลือ zombie scrcpy/ADB process

และไม่ควรเกิด memory leak

## Existing Live Control

ถ้ามี Live Control / scrcpy viewer อยู่แล้ว:

reuse stream/session/controller เดิมให้มากที่สุด

Device Wall ควรเป็นอีก presentation layer หนึ่งของระบบ device session เดิม

ไม่สร้าง remote-control engine ใหม่

## Scope รอบแรก

Implement ให้ใช้งานได้จริงก่อน:

1. Device Wall route
2. Device grid
3. Device status
4. Live preview
5. Search/filter
6. Single select
7. Multi-select
8. Double click → Live Control
9. Basic multi-device actions
10. Proper stream lifecycle

ยังไม่ต้องทำ:

* Sync Touch
* Smart Broadcast
* Automated Testing
* Screenshot Diff
* Recording ทุก device
* Advanced monitoring

ให้เตรียม architecture รองรับของเหล่านี้ในอนาคต แต่ยังไม่ต้อง implement

## หลังทำเสร็จ

สรุปให้ผมด้วยว่า:

* แก้/เพิ่มไฟล์อะไร
* reuse ระบบเดิมตรงไหน
* Device Wall stream ทำงานอย่างไร
* มี process/resource cleanup ตรงไหน
* รองรับพร้อมกันประมาณกี่ device ตาม architecture ปัจจุบัน
* จุดไหนควร optimize เพิ่มหากต้องการ 20–50 devices

สำคัญ:
อย่าเริ่ม rewrite โปรเจกต์ใหม่
Inspect existing implementation ก่อนทุกครั้ง และแก้เท่าที่จำเป็น
