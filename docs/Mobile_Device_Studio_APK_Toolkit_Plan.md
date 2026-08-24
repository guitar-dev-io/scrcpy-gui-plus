# Mobile Device Studio
## APK Toolkit & App Manager Enhancement Plan

> **Scope:** Android / ADB / Local & Small-Team Workflow  
> **Direction:** เพิ่มเครื่องมือสำหรับ Dev/QA โดยใช้ **App Manager เป็นจุดเริ่มต้น** และค่อยแยก `APK Toolkit` เป็นหน้าเฉพาะเมื่อความสามารถมากพอ  
> **Out of scope:** Cloud Device Farm, BrowserStack/Firebase Test Lab/AWS Device Farm-style infrastructure

---

## 1. เป้าหมาย

เพิ่มความสามารถให้ Mobile Device Studio สำหรับจัดการและวิเคราะห์แอป Android ที่ติดตั้งอยู่บนอุปกรณ์จริง โดยเน้น:

- Extract Installed APK
- รองรับ Split APK
- APK Inspector
- Package / Permission / Signature Inspector
- APK Compare
- Backup / Export APK Set
- Local APK Toolkit
- Optional `jadx` / `apktool` integration
- เชื่อมต่อกับ App Manager, File Explorer, Shell, Logcat และ Multi-device infrastructure เดิม

หลักสำคัญคือ **reuse architecture เดิม** และหลีกเลี่ยงการสร้าง ADB/package service ซ้ำโดยไม่จำเป็น

---

## 2. Priority

| Priority | Feature | ตำแหน่งหลัก | เหตุผล |
|---|---|---|---|
| P1 | Extract Installed APK + Split APK | App Inspector | ใช้บ่อยและต่อยอดจาก package info ได้โดยตรง |
| P1 | APK Inspector | App Inspector / APK Toolkit | ดู metadata, permissions, SDK, ABI, signing |
| P1 | Package / Permission / Signature Inspector | App Inspector | ช่วยตรวจ release/debug ได้ทันที |
| P2 | Compare APK vs Installed App | APK Toolkit | ตรวจความต่างก่อน/หลัง deploy |
| P2 | Backup / Export APK Set | App Inspector | เก็บ base + splits + metadata เป็นชุดเดียว |
| P3 | Local APK Toolkit | Tools | เปิด APK จากเครื่องคอมเพื่อ inspect/compare/install |
| P3 | jadx / apktool Integration | Advanced / Optional | เพิ่มความสามารถเชิงลึกโดยไม่ผูกกับ core |

---

# 3. Product Direction

## 3.1 เริ่มจาก App Manager ก่อน

ไม่ควรเพิ่มเมนู `APK Toolkit` ตั้งแต่แรกถ้ายังมีเพียง Extract/Inspect ไม่กี่ action เพราะจะทำให้ Sidebar หนาแน่นโดยไม่จำเป็น

Recommended flow:

```text
App Manager
  └─ Select App
      └─ App Inspector
          ├─ Launch / Force Stop
          ├─ Clear Cache / Clear Data
          ├─ Open Logcat / Shell / App Data
          ├─ Extract APK
          ├─ APK Inspector
          ├─ Compare with APK...
          └─ Backup / Export
```

## 3.2 เมื่อใดควรแยกเป็น APK Toolkit

ค่อยเพิ่ม:

```text
Tools
└─ APK Toolkit
```

เมื่อรองรับ workflow สำหรับไฟล์ local มากขึ้น เช่น:

- Inspect
- Compare
- Install
- Verify Signature
- Extract Contents
- View Manifest
- View Permissions
- View Components
- Recent APK history

## 3.3 Shared Core

Installed App workflow และ Local APK workflow ควรใช้ analyzer/model/signing verifier ชุดเดียวกัน

```text
Installed App ─┐
               ├─> APK Analyzer Core
Local APK ─────┘
```

---

# 4. Extract Installed APK

ต้องรองรับทั้ง **Single APK** และ **Split APK**

## 4.1 Discover APK Paths

ใช้ infrastructure เดิมในการรัน:

```bash
adb shell pm path <package>
```

ตัวอย่าง:

```text
package:/data/app/.../base.apk
package:/data/app/.../split_config.arm64_v8a.apk
package:/data/app/.../split_config.xxhdpi.apk
package:/data/app/.../split_config.en.apk
```

ระบบต้อง detect ว่า package มี:

- Base APK
- ABI splits
- Density splits
- Language splits
- Other splits

## 4.2 Extract Dialog

```text
Extract APK
────────────────────────────

Chrome
com.android.chrome

Device
ELS-NX9

APK Files
✓ base.apk                       118 MB
✓ split_config.arm64_v8a.apk      42 MB
✓ split_config.xxhdpi.apk         23 MB
✓ split_config.en.apk              2 MB

Export as

● APK Set (.zip)
○ Individual APK files
○ Base APK only

[ Cancel ]                 [ Extract ]
```

## 4.3 Required Behavior

- ผูกคำสั่งทุกชุดกับ `deviceId` / serial ที่ถูกต้อง
- ตรวจ package paths ก่อน pull
- แสดง progress รายไฟล์
- แสดง overall progress
- รองรับ cancel ถ้า architecture เดิมรองรับ
- split ใด pull fail ต้องรายงาน partial failure
- sanitize filename/folder name
- ห้าม overwrite เงียบ ๆ
- ใช้ duplicate-safe filename หรือ convention เดิมของโปรเจกต์
- เก็บ metadata ของ extraction

Suggested metadata:

```json
{
  "packageName": "com.android.chrome",
  "versionName": "140.0.7339.80",
  "versionCode": 733908065,
  "deviceModel": "ELS-NX9",
  "androidVersion": "10",
  "extractedAt": "..."
}
```

## 4.4 Recommended Output

```text
Chrome_140.0.7339.80/
├─ base.apk
├─ split_config.arm64_v8a.apk
├─ split_config.xxhdpi.apk
├─ split_config.en.apk
└─ metadata.json
```

---

# 5. APK Inspector

APK Inspector ต้องเปิดได้ทั้งจาก:

1. APK ที่ extract จาก device
2. APK local ที่เปิดจากเครื่องคอม
3. APK Set / backup ที่โปรเจกต์สร้างไว้

โดยใช้ UI และ data model ชุดเดียวกัน

## 5.1 General

แสดง:

- Package
- App Label
- Version Name
- Version Code
- Min SDK
- Target SDK
- Compile SDK (ถ้าดึงได้)
- APK size
- Split count

## 5.2 Permissions

แสดง:

- Requested permissions
- Granted state เมื่อ inspect installed package
- Dangerous permissions
- Protection level ถ้าดึงได้

ตัวอย่าง:

```text
PERMISSIONS

CAMERA
ACCESS_FINE_LOCATION
POST_NOTIFICATIONS
```

## 5.3 Components

แสดง:

- Activities
- Services
- Broadcast Receivers
- Content Providers
- Exported state
- Main/launcher activity ถ้าระบุได้

## 5.4 Native

แสดง:

- Supported ABI
- Native libraries
- Architecture coverage

ตัวอย่าง:

```text
NATIVE

arm64-v8a
armeabi-v7a
```

## 5.5 Signing

แสดง:

- Signer / certificate summary
- SHA-256 fingerprint
- Signing schemes ที่ตรวจได้
- Validation result

ตัวอย่าง:

```text
SIGNING

Signer     CN=...
SHA-256    ...
Status     Valid
```

## 5.6 Files

แสดง:

- Base APK
- Split APKs
- File sizes
- SHA-256 hashes

---

# 6. Package / Permission / Signature Inspector

App Inspector ควรแสดงข้อมูลที่ดึงจาก device ได้เร็วโดย **ไม่ต้อง pull APK ก่อน**

## 6.1 Quick Package Checks

- Package name
- App label
- Version
- Version code
- Install path
- Split paths
- UID
- Target SDK
- Enabled
- Debuggable
- Requested permissions
- Granted permissions
- Installer/source package
- Signer summary / fingerprint เมื่อรองรับ

## 6.2 UX Rule

แยกข้อมูลเป็น 2 ชั้น:

```text
Fast package metadata
        ↓
แสดงทันที

Heavy APK analysis
        ↓
โหลด on-demand
```

ห้าม pull/analyze APK โดยอัตโนมัติทันทีที่เลือก app row เพราะจะทำให้ App Manager ช้า

---

# 7. APK Compare

APK Compare ใช้สำหรับ QA/Release เพื่อตรวจว่า build ใหม่ต่างจากของที่ติดตั้งอยู่บน device อย่างไร

## 7.1 Compare Sources

รองรับ:

- Installed App vs Local APK
- Extracted APK Set vs Local APK
- Local APK vs Local APK
- Current Build vs Saved Baseline Metadata (optional later)

## 7.2 Compare UI

```text
APK Compare

Installed
com.example.app
v2.5.3

VS

Local APK
staging.apk
v2.5.4

────────────────────────────

Version
2.5.3 → 2.5.4

Target SDK
35 → 36

Total Size
84 MB → 92 MB

Permissions
+ POST_NOTIFICATIONS
- READ_PHONE_STATE

Native Libraries
+ libnewfeature.so

Signature
✓ Same signer
```

## 7.3 Comparison Categories

| Category | Compare |
|---|---|
| Identity | package, version, versionCode |
| SDK | minSdk, targetSdk, compileSdk |
| Permissions | added / removed permissions |
| Components | added / removed activities, services, receivers, providers |
| Native | ABI / `.so` changes |
| Signing | same signer / changed signer / validation |
| Size | base, splits, total size |

## 7.4 Important Signing Rule

แยกความหมายระหว่าง:

```text
Same signer
```

กับ:

```text
Signature validation successful
```

สองอย่างนี้ไม่ใช่สิ่งเดียวกัน

---

# 8. Backup / Export APK Set

Backup ใน core scope ควรเน้น **installation files + metadata**

ไม่ควร include App Data เป็น default เพราะ:

- Android permission constraints
- backup limitations
- อาจมีข้อมูลผู้ใช้หรือ secrets

## 8.1 UI

```text
Backup Installed App

App
WashXpress

Include
✓ Base APK
✓ Split APKs
✓ Package metadata
□ App data (Advanced / only when supported)

Output
WashXpress_2.5.3_android14.zip
```

## 8.2 Archive Structure

```text
WashXpress_2.5.3_android14.zip
├─ apk/
│  ├─ base.apk
│  ├─ split_config.arm64_v8a.apk
│  └─ ...
├─ metadata.json
├─ permissions.json
└─ signature.json
```

เป้าหมายคือ archive ที่สามารถเปิดกลับมา:

- Inspect
- Compare
- Install
- Verify

ได้ในอนาคต

---

# 9. Local APK Toolkit

เมื่อ feature โตพอ ให้เพิ่ม:

```text
Tools
└─ APK Toolkit
```

โดยหน้า Local APK Toolkit ไม่ควร require device connected

## 9.1 Main UI

```text
APK Toolkit

Drop APK / APKS here
or
[ Open APK ]

Recent Files
────────────────────────
staging-2.5.4.apk
production-2.5.3.apk
debug.apk

Actions
[ Inspect ]
[ Compare ]
[ Install ]
[ Verify ]
[ Extract Contents ]
```

## 9.2 Suggested Actions

- Inspect metadata
- Compare APK
- Compare with installed app
- Install to current device
- Install to selected devices
- Install to Device Group
- Verify signature
- View AndroidManifest info
- View permissions
- View components
- Extract contents
- Calculate hash

การติดตั้งหลายเครื่องต้อง reuse Multi-device infrastructure เดิม

---

# 10. jadx / apktool Integration

`jadx` และ `apktool` ให้เป็น **Optional Integration**

ไม่ควรเป็น dependency หลักของ App Manager หรือ APK Inspector

เหตุผล:

- installation complexity
- version compatibility
- output size
- processing time
- lifecycle ของ generated files

## 10.1 Recommended Approach

- ตรวจ binary/version ก่อนใช้งาน
- ถ้าไม่พบ ให้แสดง Install/Configure instructions
- ห้าม fail เงียบ
- run เป็น background job
- มี progress
- cancel ได้
- output อยู่ใน workspace/temp ที่ควบคุม lifecycle ได้
- เปิดผลผ่าน File Explorer/editor integration เดิม

## 10.2 Out of Scope for Core

APK Inspector พื้นฐานต้องทำงานได้โดยไม่ต้องมี:

```text
jadx
apktool
```

---

# 11. App Manager Integration

App Inspector ด้านขวาเป็นศูนย์กลางของ action

```text
App Inspector

Chrome
com.android.chrome
[User App]

Quick Actions
[ Launch ]       [ Force Stop ]
[ Clear Cache ]  [ Clear Data ]

Developer Tools
[ Open App Data ]    [ Open Logcat ]
[ Shell in Package ] [ Package Info ]
[ Extract APK ]      [ APK Inspector ]
[ Compare with APK ] [ Backup / Export ]

Danger Zone
[ Uninstall App ]
```

## 11.1 Action Hierarchy

| Level | Actions | Visual |
|---|---|---|
| Primary | Launch, Install APK, Extract APK | Purple |
| Normal | Logcat, Shell, Package Info, Inspector | Neutral |
| Warning | Force Stop, Disable | Amber / subtle red |
| Destructive | Clear Data, Uninstall | Red + confirmation |

---

# 12. Technical Architecture

## 12.1 Reuse Existing Infrastructure

ห้ามสร้าง ADB/package service ใหม่ถ้ามีของเดิมรองรับอยู่แล้ว

Preferred flow:

```text
App Manager UI
      ↓
Existing Package / Device Service
      ├─ list packages
      ├─ package info
      ├─ pm path
      ├─ pull file(s)
      ├─ install
      ├─ uninstall
      └─ package actions
      ↓
APK Analyzer Core
      ├─ metadata
      ├─ permissions
      ├─ components
      ├─ native ABI
      └─ signing
      ↓
App Inspector / APK Toolkit / APK Compare
```

## 12.2 Suggested Domain Models

```ts
type ApkSource = 'device' | 'local';

interface ApkSet {
  packageName: string;
  versionName?: string;
  versionCode?: number | string;
  files: ApkFile[];
  source: ApkSource;
}

interface ApkFile {
  path: string;
  type: 'base' | 'split';
  splitName?: string;
  size?: number;
  sha256?: string;
}

interface ApkAnalysis {
  general: unknown;
  permissions: unknown[];
  components: unknown;
  nativeLibraries: unknown[];
  signing: unknown;
}
```

ปรับให้เข้ากับ types/models ของ project เดิมก่อนสร้าง type ใหม่

---

# 13. Performance Rules

- อย่า pull APK ตอน select app row โดยอัตโนมัติ
- Package list ใช้ metadata เบา ๆ
- โหลด package detail เมื่อเลือก app
- APK analysis ทำเป็น background task
- cancel analysis ได้ถ้าใช้เวลานาน
- cache analysis ตาม file hash/path เมื่อเหมาะสม
- Multi-device extract ต้องจำกัด concurrency
- ห้ามยิง `adb pull` จำนวนมากพร้อมกันโดยไม่มี limit
- heavy file hashing ไม่ควร block UI thread

---

# 14. Security & Safety UX

- `Clear Data` ต้องมี confirmation
- `Uninstall` ต้องมี confirmation
- `Backup App Data` ไม่เป็น default
- อธิบายข้อจำกัดของ App Data backup
- ห้าม export secrets/tokens/logs โดยอัตโนมัติ
- system package action ที่ไม่รองรับต้อง disable พร้อมเหตุผล
- อย่าปล่อยให้ action fail เงียบ
- sanitize export paths
- ไม่ overwrite export เดิมโดยไม่แจ้ง

---

# 15. Implementation Roadmap

## Phase 1 — Extract APK + Split APK

**Status:** Implementation complete; physical-device QA pending

**Scope**
- `pm path`
- detect base/splits
- pull files
- progress
- export folder/zip
- metadata

**Definition of Done**
- Extract base APK ได้
- Extract split APK ได้
- รายงาน partial failure
- Export ไม่ชนชื่อเดิม
- metadata ถูกต้อง

---

## Phase 2 — APK Inspector

**Status:** Implementation complete; physical-device QA pending

**Scope**
- General
- Permissions
- Components
- Native
- Signing
- File hashes

**Definition of Done**
- Inspector วิเคราะห์ไฟล์จริง
- เปิด extracted/local APK ได้
- แสดง unsupported/missing data อย่างชัดเจน

---

## Phase 3 — App Manager Integration

**Status:** Implementation complete; physical-device QA pending

**Scope**
- Extract APK
- APK Inspector
- Package Info
- Developer Tools integration

**Definition of Done**
- เปิด feature ทั้งหมดจาก App Inspector ได้
- ใช้ selected app + selected device context ถูกต้อง
- Logcat/Shell/File Explorer reuse ของเดิม

---

## Phase 4 — APK Compare

**Status:** Implementation complete; physical-device QA pending

**Scope**
- Installed vs Local APK
- Identity
- SDK
- Permissions
- Components
- Native
- Signing
- Size

**Definition of Done**
- แสดง `added / removed / changed`
- same signer / changed signer ชัดเจน
- compare result ไม่ผูกกับ UI อย่างเดียว

---

## Phase 5 — Backup / Export

**Status:** Implementation complete; physical-device QA pending

**Scope**
- APK Set archive
- metadata
- permissions
- signature

**Definition of Done**
- Archive เปิดกลับมา inspect ได้
- file layout stable
- split APK preserved

---

## Phase 6 — Local APK Toolkit

**Status:** Implementation complete

**Scope**
- Open local APK
- recent files
- inspect
- compare
- install
- verify
- extract contents

**Definition of Done**
- ใช้งานได้แม้ไม่มี device connected
- reuse analyzer core เดิม

---

## Phase 7 — Optional jadx / apktool

**Status:** Implementation complete; optional-tool QA pending

**Scope**
- binary detection
- Java runtime detection and user-facing requirements
- configure directory or tool file path (`apktool*.jar` supported via Java)
- background job
- output lifecycle
- File Explorer integration

**Definition of Done**
- optional จริง
- core ไม่พังเมื่อไม่ได้ติดตั้ง tool

---

# 16. Codex Implementation Checklist

ก่อนลงมือให้ Codex inspect ของเดิมและ reuse components/services ที่มีอยู่ โดยเฉพาะ:

- App Manager
- Package actions
- DeviceCommand
- File Explorer
- Shell
- Logcat
- Multi-device executor

Checklist:

- [x] ค้นหา existing package list / package info
- [x] ค้นหา existing `pm path`
- [x] ค้นหา existing ADB pull logic
- [x] ตรวจว่ามี Pull APK / Share APK อยู่แล้วหรือไม่
- [x] เพิ่ม Split APK detection โดยไม่ทำ service ซ้ำ
- [x] สร้าง Extract dialog และผูก selected app/device จริง
- [x] สร้าง analyzer core ที่ใช้ได้กับ installed/extracted/local APK
- [x] เพิ่ม APK Inspector
- [x] เพิ่ม Compare flow แบบ structured
- [x] เพิ่ม Backup/Export archive พร้อม metadata
- [x] เชื่อม Logcat / Shell / Files ด้วย device/package context เดิม
- [x] เพิ่ม tests
- [ ] Manual QA ด้วย package จริงบน device

หลังแต่ละ phase:

```text
build
typecheck
lint
test
manual device verification
```

---

# 17. Acceptance Criteria

- [x] Extract installed app ได้ทั้ง base APK และ split APK
- [x] แสดงรายการ split และขนาดจริงเมื่อดึงได้
- [x] Export APK Set ได้โดยไฟล์ไม่ชนชื่อเดิม
- [x] APK Inspector เปิดได้จาก App Manager
- [x] APK Inspector เปิด local APK ได้
- [x] แสดง package/version/SDK จากข้อมูลจริง
- [x] แสดง permissions จากข้อมูลจริง
- [x] แสดง components จากข้อมูลจริง
- [x] แสดง native ABI/libraries จากข้อมูลจริง
- [x] แสดง signing information จากข้อมูลจริง
- [x] Compare Installed vs Local APK ได้
- [x] Compare แสดง added/removed/changed แบบเข้าใจง่าย
- [x] Backup archive มี APK files + metadata
- [x] Backup archive เปิดกลับมา validate และ inspect base APK ได้
- [x] App Manager ใช้ purple เป็น primary
- [x] Red ใช้เฉพาะ destructive action
- [x] ไม่มี duplicated ADB/package services โดยไม่จำเป็น
- [x] Open Logcat ใช้ package context ถูกต้อง
- [x] Shell ใช้ device/package context ถูกต้อง
- [x] File Explorer ใช้ device/package context ถูกต้อง
- [x] ไม่ pull/analyze APK ทุกแอปใน list โดยอัตโนมัติ
- [x] build ผ่าน
- [x] typecheck ผ่าน
- [x] tests ผ่าน
- [x] App Manager เดิมไม่ regression

---

# 18. Recommended MVP

รอบแรกแนะนำให้ทำ:

1. **Extract Installed APK + Split APK**
2. **APK Inspector**
3. **Package / Permission / Signature Inspector**
4. **App Manager Integration**

รอบถัดไป:

5. APK Compare
6. Backup / Export APK Set
7. Local APK Toolkit
8. Optional `jadx` / `apktool`

---

# 19. Final Direction

เป้าหมายไม่ใช่ทำ APK decompiler ขนาดใหญ่ แต่ให้ Mobile Device Studio กลายเป็น developer workspace ที่ทำ workflow นี้ได้จากจุดเดียว:

```text
Connect Device
     ↓
App Manager
     ↓
Select App
     ↓
Inspect Package
     ↓
Extract APK
     ↓
Inspect APK
     ↓
Compare Build
     ↓
Open Logcat / Shell / Files
     ↓
Install / Reinstall / Export
```

ทั้งหมดควร reuse **Device Context, Package Context, ADB Infrastructure, Multi-device Infrastructure และ Developer Tools เดิม** ให้มากที่สุด
