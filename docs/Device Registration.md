ช่วยตรวจสอบโปรเจกต์ Mobile Studio ปัจจุบันก่อน แล้วเพิ่มระบบสำหรับเชื่อม Android Device เข้ากับ Desktop ผ่าน Mobile Studio Agent

เป้าหมายคือ:

Install Agent APK บนมือถือ
→ เปิด Agent
→ Scan QR จาก Desktop
→ Device Register เข้า Mobile Studio
→ แสดงใน Device Wall
→ Setup Wireless Debugging / ADB
→ พร้อมใช้งาน Live Control

สำคัญ:

* Inspect existing architecture ก่อน
* reuse ระบบ ADB / scrcpy / device manager / websocket เดิมถ้ามี
* ห้าม rewrite ระบบเดิมโดยไม่จำเป็น
* ห้ามสร้าง device connection manager ซ้ำ
* รักษา UI style / dark theme ปัจจุบัน

## 1. Desktop — Pair New Device

เพิ่ม action:

`Devices > Add Device`

หรือปุ่ม:

`+ Add Device`

เปิดหน้า/Modal:

```text
Pair New Device

Install Mobile Studio Agent on your Android device
then scan this QR code.

        [ QR CODE ]

ws://192.168.1.50:8765

Expires in 5 minutes

1. Install Mobile Studio Agent
2. Open Agent
3. Tap "Add Studio"
4. Scan QR
5. Device appears in Device Wall

[ Download Agent APK ]
```

QR ต้อง encode pairing payload เช่น:

```json
{
  "version": 1,
  "studioId": "studio_xxxxx",
  "host": "192.168.1.50",
  "port": 8765,
  "token": "temporary-pair-token",
  "expiresAt": 1790000000
}
```

Token ต้อง:

* random
* ใช้ได้ครั้งเดียว
* มี expiration
* invalid หลัง pair สำเร็จ

ห้าม encode secret ถาวรไว้ใน QR

## 2. Mobile Studio Agent

ถ้ามี Android Agent project อยู่แล้ว ให้ inspect และต่อยอด

ถ้ายังไม่มี ให้สร้างเป็น module/project แยกจาก Desktop ให้ชัดเจน

หน้าแรก:

```text
Mobile Studio Agent

Connect your Android device
to Mobile Studio on your computer.

[ Add Studio ]

Device Info
Settings
```

เมื่อกด `Add Studio`

เปิด QR Scanner

หลัง scan ให้:

1. validate QR
2. connect Desktop
3. authenticate pairing token
4. register device
5. save Studio connection
6. เปิด persistent connection

## 3. Device Registration

Agent ส่งข้อมูลประมาณ:

```json
{
  "deviceId": "persistent-agent-id",
  "deviceName": "Xiaomi 17 Ultra",
  "manufacturer": "Xiaomi",
  "model": "2512BPNDAC",
  "androidVersion": "16",
  "sdk": 36,
  "ip": "192.168.1.120",
  "battery": 82,
  "agentVersion": "1.0.0"
}
```

สำคัญ:

ห้ามใช้ IP หรือ adb serial เป็น Device ID หลัก

ใช้ persistent ID เช่น:

```text
studioDeviceId
agentDeviceId
adbSerial
currentIp
```

ตัวอย่าง:

```text
studioDeviceId = dev_93ab8f
agentDeviceId  = agent_218734
adbSerial      = 192.168.1.120:42155
```

adbSerial และ IP เปลี่ยนได้

แต่ studioDeviceId ต้องไม่เปลี่ยน

## 4. Agent Connection

ใช้ persistent WebSocket connection

Agent → Desktop

ส่ง heartbeat ทุกประมาณ 5–15 วินาที

ตัวอย่าง:

```json
{
  "type": "heartbeat",
  "deviceId": "dev_93ab8f",
  "battery": 82,
  "screenOn": true,
  "wifiConnected": true,
  "foregroundPackage": "com.example.app"
}
```

Desktop ต้อง detect:

* Connected
* Disconnected
* Reconnecting
* Offline

อย่า mark offline จาก heartbeat miss เพียงครั้งเดียว

ให้มี timeout ที่เหมาะสม

## 5. Agent Status UI

หลัง pair สำเร็จ หน้า Agent แสดง:

```text
Mobile Studio Agent

● Connected

Connected to
MacBook Pro
192.168.1.50

Device Information
Xiaomi 17 Ultra
Android 16
Battery 82%
Wi-Fi Connected

Connection Status

Agent               ● Connected
Wireless Debugging  ● / ○
ADB                  ● / ○
Screen Control       ● / ○

[ Setup Wireless Debugging ]
```

## 6. Device Capability Model

Desktop ต้องไม่ถือว่า Device ทุกเครื่องมี capability เท่ากัน

สร้าง capability model เช่น:

```json
{
  "agent": true,
  "adb": false,
  "screen": false,
  "input": false,
  "shell": false,
  "installApk": false,
  "logcat": false,
  "root": false
}
```

Device Wall ต้องสามารถแสดง:

```text
Agent ●
ADB   ○
Screen ○
```

เมื่อ ADB พร้อม:

```text
Agent ●
ADB   ●
Screen ●
```

## 7. Wireless Debugging Setup

เพิ่มหน้า:

`Setup Device Control`

Flow:

```text
1. Enable Developer Options
2. Enable Wireless Debugging
3. Pair with Mobile Studio
4. Connect
```

อย่าพยายาม bypass Android security

User ยังต้องเปิด Developer Options / Wireless Debugging เอง

Desktop สามารถช่วย:

* แสดง instruction
* รับ pairing code
* รัน adb pair
* รัน adb connect
* validate connection

ตัวอย่าง Desktop flow:

```text
Pairing address:
192.168.1.120:37123

Pairing code:
123456

[ Pair Device ]
```

แล้วใช้ command layer เดิม เช่น:

```bash
adb pair host:port
adb connect host:port
```

แต่ให้ reuse service/process abstraction เดิมในโปรเจกต์

ห้าม execute command ตรงจาก UI component

## 8. Auto Match Agent ↔ ADB Device

หลัง adb connect สำเร็จ

Desktop ต้อง map ADB device เข้ากับ registered Agent device เดิม

อย่าสร้าง duplicate device

ต้องได้:

```text
Agent Device
      +
ADB Device
      ↓
One Device Entry
```

ใช้ข้อมูลประกอบ เช่น:

* model
* manufacturer
* IP
* Android version
* agent-provided identity

ถ้า match ไม่แน่ใจ ห้าม merge แบบเดาสุ่ม

## 9. Device Wall Integration

หลัง Agent register สำเร็จ

Device ต้องขึ้นใน Device Wall ทันที

ตัวอย่าง:

```text
Xiaomi 17 Ultra
Android 16

● Online

Agent  ●
ADB    ○
Screen ○
```

เมื่อ Wireless ADB connect:

```text
Xiaomi 17 Ultra

● Ready

Agent  ●
ADB    ●
Screen ●
```

Device ที่มี Agent อย่างเดียวก็ยังต้องแสดงใน Wall ได้

แต่ action ที่ต้องใช้ ADB ให้ disabled

เช่น:

```text
ADB Shell
Install APK
Clear App Data
scrcpy Live Control
```

## 10. Live Control

เมื่อ:

* Agent connected
* ADB connected

ให้ใช้ scrcpy pipeline เดิม

Flow:

```text
Device Wall
   ↓
Open Live Control
   ↓
check ADB
   ↓
reuse/create scrcpy session
   ↓
show device screen
```

ห้ามใช้ Agent ทำ screen mirroring ใหม่ ถ้ามี scrcpy อยู่แล้ว

Agent ใช้สำหรับ:

* discovery
* pairing
* heartbeat
* metadata
* health
* reconnect assistance

ADB/scrcpy ใช้สำหรับ:

* screen
* touch
* keyboard
* shell
* app install
* logcat
* files

## 11. Reconnect

เมื่อ Desktop restart:

Agent ต้อง reconnect ได้อัตโนมัติถ้า Studio เดิมยัง trusted

เมื่อ Agent reconnect:

```text
registered device
↓
online
↓
check existing adb connection
↓
attempt reconnect if previously configured
```

อย่าทำ ADB retry แบบ tight loop

ใช้ backoff เช่น:

```text
2s
5s
10s
30s
```

และมี max retry / idle state

## 12. Security

Pairing ต้องมี:

* expiring token
* one-time token
* studio identity
* device identity
* trusted studio list

หลัง pair สำเร็จ:

Agent ต้องไม่ accept Desktop อื่นโดยอัตโนมัติ

ถ้าจะ pair Studio ใหม่ ต้องให้ user approve

เพิ่ม:

`Trusted Studios`

เช่น:

```text
MacBook Pro
Last connected: now

[ Forget ]
```

## 13. Architecture

ปรับให้เข้ากับ architecture เดิม

แนวคิด service อาจประมาณ:

```text
DeviceRegistry
AgentConnectionService
PairingService
DeviceCapabilityService
AdbDeviceService
DeviceSessionManager
ScrcpySessionManager
```

ชื่อไม่จำเป็นต้องเหมือนนี้

ให้ reuse service ที่มีอยู่ก่อน

UI ไม่ควรคุยกับ WebSocket/ADB process โดยตรง

## 14. Scope รอบแรก

Implement ก่อน:

1. Pair Device Desktop UI
2. QR pairing token
3. Agent Add Studio
4. QR scanner
5. Device registration
6. Persistent device ID
7. WebSocket connection
8. Heartbeat
9. Agent status
10. Device Wall integration
11. Capability model
12. Wireless Debugging setup UI
13. adb pair / adb connect integration
14. Agent ↔ ADB device matching
15. reconnect basic flow

ยังไม่ต้องทำ:

* internet/cloud relay
* device outside LAN
* NAT traversal
* remote streaming through server
* sync touch
* smart broadcast
* unattended Android security bypass
* custom screen streaming engine

## 15. UI

ให้ UI สอดคล้องกับ Mobile Studio ปัจจุบัน

ใช้ minimal dark dashboard

หน้า Pair Device และ Mobile Agent ต้องไม่ดูซับซ้อน

Primary flow ต้องชัด:

```text
Install Agent
→ Scan QR
→ Connected
→ Setup ADB
→ Ready
```

## 16. หลัง Implement

สรุปให้ผม:

* architecture ที่พบเดิม
* reuse อะไรบ้าง
* เพิ่มไฟล์อะไร
* Device ID เก็บยังไง
* QR payload เป็นอะไร
* WebSocket lifecycle
* heartbeat lifecycle
* reconnect lifecycle
* Agent ↔ ADB matching ทำยังไง
* capability model
* scrcpy reuse จุดไหน
* security ของ pairing
* known limitations

และระบุชัดเจนว่า flow ปัจจุบันรองรับ:

Agent only
Agent + ADB
Agent + ADB + scrcpy

แต่ละ mode ทำอะไรได้บ้าง

ก่อนแก้ code ให้ inspect implementation เดิมก่อนเสมอ และอย่าสร้างระบบซ้ำถ้ามีของเดิมอยู่แล้ว
