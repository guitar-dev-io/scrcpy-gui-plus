# Gap Analysis: scrcpy-gui-plus vs hihumanzone/opendroid_remote

## 1. สรุปคำตอบ (ผมขาดอะไรใน project นี้)

สองโปรเจกต์ **คนละประเภทกัน** จึงไม่ใช่การ "ขาด feature" แบบตรงๆ:
- **opendroid_remote** = เว็บล้วน (browser-only) ใช้ WebUSB + ADB + scrcpy server ผ่าน ya-webadb, decode ด้วย WebCodecs, ไม่มี app บนมือถือ/ไม่มี backend. จุดเด่นคือ **game key-mapping editor**, per-game profiles (import/export JSON + JSON Schema), UHID physical mouse + Pointer Lock, audio forwarding, auto codec fallback, ADB key ring ที่คงที่ และ **เอกสารกับ unit test ที่เจาะลึกเฉพาะ domain**.
- **scrcpy-gui-plus** (ของคุณ) = Tauri v2 + React 19 + Rust desktop app ที่ครอบ scrcpy CLI + Android companion (Kotlin) + เครื่องมือ QA/automation (Maestro, Robot, APK toolkit, device farm, logcat ฯลฯ). กว้างกว่ามาก.

สิ่งที่คุณ **ขาดจริงๆ** เมื่อเทียบ (เรียงตามความสำคัญ):
1. **Game mapping แบบ visual + profile ต่อเกม** (tap/hold/swipe/WASD joystick/mouse-look) ที่ reference มี — คุณมีแค่ `src/components/keymap-controller/KeymapController.tsx` และ `macro-recorder` ซึ่งไม่ครบระดับเดียวกัน (ยังไม่ได้ตรวจเนื้อหาในไฟล์เหล่านั้นอย่างละเอียด).
2. **Pointer Lock / mouse-look, multi-touch ที่มี pointer ID อิสระ, emergency key** — ไม่พบใน repo ของคุณ (คุณใช้ `--keyboard=uhid/--mouse=uhid` ผ่าน scrcpy ใน `src-tauri/src/commands.rs:1192-1202` เท่านั้น).
3. **เอกสารมาตรฐานโปรเจกต์**: ไม่มี `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`, `docs/ARCHITECTURE.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/SETTINGS.md`, compatibility matrix (reference มีครบ).
4. **Lint จริง**: script `lint` ของคุณคือ `tsc --noEmit` (`package.json`) ไม่มี ESLint config; reference มี `eslint.config.mjs`.
5. **Security hardening**: `src-tauri/tauri.conf.json:38` มี `"csp": null` (ไม่มี Content-Security-Policy). reference ไม่มี backend/analytics และ pin + SHA-256 verify scrcpy server (`public/vendor/SCRCPY-SHA256.txt`); คุณดาวน์โหลด binary scrcpy อัตโนมัติ (README "Automated Binary Updates") — **ยังไม่ได้ตรวจว่ามี checksum verification หรือไม่**.
6. **Test ฝั่ง Rust และ Android UI/e2e น้อย**: unit tests ใน `src-tauri` มีเพียง 29 ไฟล์ที่มี `#[cfg(test)]` (ไม่ได้ตรวจความครอบคลุม) และ CI ไม่รัน Kotlin unit tests (ดูข้อ 4).
7. **ไม่มี zero-install / hosted web build** (reference deploy เป็น static site ผ่าน GitHub Pages/Vercel/Cloudflare) — ของคุณเป็น desktop เท่านั้น (ตั้งใจ ไม่จำเป็นต้องมี).

## 2. ตารางเปรียบเทียบ feature

| หมวด | opendroid_remote | scrcpy-gui-plus |
|---|---|---|
| Runtime | Browser (Chromium) + WebUSB, `src/adb/*`, `src/scrcpy/ScrcpySession.ts` | Tauri v2 / Rust (`src-tauri/src/*.rs`) + React (`src/`) |
| ต้องติดตั้ง app บนมือถือ | ไม่ต้อง | ไม่บังคับ; มี `android-companion/` (Kotlin) สำหรับ LAN/USB accessory/screen capture |
| scrcpy | server 3.3.3 bundled + SHA-256 verified | เรียก scrcpy CLI, auto-update binary |
| Video decode | WebCodecs, H.264/H.265/AV1 fallback (`codecNegotiation.ts`) | ผ่าน scrcpy native window / embedded mirror (`embed_mirror.rs`, `src/utils/webcodecsSupport.ts` มี) |
| Audio | PCM/Opus/AAC/FLAC ใน browser (`PcmAudioPlayer.ts`) | ผ่าน scrcpy (ไม่ได้ตรวจเชิงลึก) |
| Mouse/keyboard | UHID mouse, Pointer Lock, SDK-compat fallback | HID keyboard/mouse ผ่าน scrcpy flags (`commands.rs`) |
| Game mapping | Visual editor: tap/hold/swipe/joystick/mouse-look (`src/input/MappingEngine.ts`, `src/ui/MappingPanel.tsx`) | `keymap-controller`, `macro-recorder` (พื้นฐานกว่า, ไม่ได้ verify) |
| Profiles | IndexedDB + JSON Schema (`docs/profile.schema.json`) | `preset-profiles` (ไม่มี schema เป็นทางการ — ไม่พบ) |
| Multi-device | Serial-keyed concurrent ADB, auto reconnect | Device rail/wall/farm (`device-wall`, `device_tracker.rs`, `docs/DEVICE_FARM_IMPLEMENTATION_PLAN.md`) |
| Wireless ADB | ไม่มี (USB เท่านั้น) | Wireless pairing wizard + connection history |
| Diagnostics | `src/debug/Diagnostics.ts` export ได้ | `bug_report.rs`, `connection-health`, logcat |
| i18n | ไม่พบ | 8 ภาษา (`src/i18n/locales/*.ts` รวม th) |
| Themes | ไม่เด่น | 5 themes |
| PWA/offline | `public/sw.js`, manifest | ไม่มี (desktop) |
| Deploy | Vercel / GH Pages / CF Pages / static | Tauri installers + Windows portable + Nix flake |

## 3. สิ่งที่ reference มี แต่โปรเจกต์คุณไม่มี
- Game mapping engine + overlay editor + emergency key (`src/input/MappingEngine.ts`, `joystick.ts`, `TouchRegistry.ts`, `PointerIdAllocator.ts`)
- Profile import/export พร้อม schema/validation/collision policy (`src/profiles/*`, `docs/profile.schema.json`, `examples/profiles/battle-royale.json`)
- Pointer Lock + relative mouse + wheel normalization (`src/input/wheel.ts`)
- Coordinate transform ที่ test ครอบคลุมทุก rotation/letterbox (`src/coordinates/CoordinateTransform.ts`, `tests/coordinates.test.ts`)
- Serialized session lifecycle (`src/core/SerialTaskQueue.ts`) กัน race ตอน start/teardown
- Persistent ADB key ring แบบ mirror (`StableAdbCredentialStore.ts`)
- เอกสารเชิงลึก: ARCHITECTURE, COMPATIBILITY, KNOWN_LIMITATIONS, SETTINGS, PROFILE_SCHEMA, CHANGELOG, CONTRIBUTING, THIRD_PARTY_NOTICES
- Linting (ESLint), build artifact validation (`scripts/validate-artifact.mjs`), npm audit-clean claim

## 4. สิ่งที่โปรเจกต์คุณมี แต่ reference ไม่มี
- Native desktop app (Tauri) พร้อม installer, Windows portable (`scripts/build-portable.ps1`), Nix flake (`flake.nix`)
- Wireless ADB pairing, connection history, device wall/farm, multi-device parity docs
- Android companion app (Kotlin, `android-companion/`) พร้อม LAN discovery/pairing (`LanPairing.kt`), USB accessory, screen capture service, protocol validators และ unit tests 12 ไฟล์ใน `android-companion/app/src/test/`
- QA/automation: Maestro builder (`src/components/maestro-builder`), `.maestro/`, Robot Framework export, macro recorder, data-driven automation, test runner/session
- APK toolkit (analyze/backup/compare), app manager, file manager, logcat viewer, UI inspector, deep-link launcher, screenshot/auto-capture, bug report, clipboard history, QR device registration, iOS/simulator mirror (`ios.rs`, `simdeck.rs`)
- Camera/webcam mode, virtual display/desktop mode
- i18n 8 ภาษา และ theme engine
- CI/CD เต็มรูปแบบ: PR CI (lint+test+cargo clippy+tauri build), release, auto version bump, tag-on-merge, Android APK build ใน release (`.github/workflows/*.yml`)
- Frontend tests ~140 ไฟล์ (`*.test.ts(x)`)

## 5. ช่องว่าง Docs / Tests / CI / Security / UX

Docs
- README ของคุณ 153 บรรทัด + GUIDE.md 144 บรรทัด; ไม่มี CHANGELOG/CONTRIBUTING/SECURITY/THIRD_PARTY_NOTICES/ARCHITECTURE/KNOWN_LIMITATIONS (ตรวจจาก `git ls-files`). มี `docs/` จำนวนมากแต่เป็น *plan* (`*_PLAN.md`, `redesign/`) มากกว่าเอกสารผู้ใช้/สถาปัตยกรรมปัจจุบัน.
- มีไฟล์ที่ไม่ควรอยู่ใน repo: `.pnpm-store/v11/index.db` ถูก track, `semantic-review/*.md`, `refs/Screenshot ....png`, `docs/image copy.png`, `image_qr.png`, `device_image_qr.png`, `.screen-smoke-server.py`, `migrate.md` (repo hygiene).
- README ยังมีชื่อ "ScrcpyGUI v4" ขณะที่ `package.json` version = 1.0.13 (ไม่สอดคล้อง) และ Node prerequisite "v18+" ขณะที่ deps เช่น vite 8 / vitest 4 น่าจะต้อง Node ใหม่กว่า (ไม่ได้ verify).

Tests
- Frontend: ดี (~140 test files, vitest). Rust: มี `#[cfg(test)]` 29 ไฟล์ (ไม่ได้รันหรือวัด coverage). ไม่มี coverage report. Maestro flows เป็น smoke เฉพาะ WashXpress (`.maestro/washxpress-smoke.yaml`) ไม่ใช่ test ของแอปนี้เอง.
- ไม่พบ test ฝั่ง UI ของ Android companion (Compose) มีเฉพาะ JVM unit tests.

CI
- `pull_request.yml` รัน `npm run lint` (= tsc), `npm test`, `cargo clippy`, `tauri build --no-bundle` — **ไม่พบขั้นตอน `cargo test` และ Kotlin `./gradlew test`** ใน grep ของ workflow (ตรวจเฉพาะบรรทัด `run:`/`uses:` 20-25 บรรทัดแรก ควรเปิดไฟล์ยืนยัน).
- ไม่มี dependabot / `npm audit` / `cargo audit` / CodeQL; ไม่มี Pages/preview.

Security
- `tauri.conf.json:38` `"csp": null`.
- ไม่พบ checksum verification ของ scrcpy binary ที่ auto-update (ยังไม่ได้ตรวจโค้ด).
- Release signing: `android-companion/scripts/generate-release-keystore.sh` และ `*.jks` ถูก gitignore (ดี) — ไม่ได้เปิดอ่านไฟล์ keystore/.env ตามคำสั่ง.
- Package versions ใน `package.json` ส่วนใหญ่ pin แน่นอน (ดี) ยกเว้น `flexlayout-react: ^0.11.0`.
- ไม่มี SECURITY.md/นโยบายรายงานช่องโหว่.

UX
- ไม่มี onboarding ที่แก้ปัญหา connection แบบ symptom→action table (reference มีใน README) — GUIDE.md มี setup แต่ไม่ได้ตรวจเนื้อหา troubleshooting.
- ไม่มี game-oriented UX (mapping overlay, Play/Edit mode).

## 6. ข้อเสนอแนะ (เรียงตามความสำคัญ)

| # | ระดับ | ข้อเสนอ | Effort |
|---|---|---|---|
| 1 | High | ตั้ง CSP ใน `src-tauri/tauri.conf.json` (แทน `null`) และทดสอบ dev/prod | 0.5-1 วัน |
| 2 | High | เพิ่ม `cargo test` และ `./gradlew testDebugUnitTest` ใน `.github/workflows/pull_request.yml` (ยืนยันก่อนว่ายังไม่มี) | 0.5 วัน |
| 3 | High | ตรวจ/เพิ่ม SHA-256 verification ของ scrcpy binary ที่ดาวน์โหลดใน auto-update | 1-2 วัน |
| 4 | Medium | เพิ่ม ESLint (typescript-eslint + react-hooks) แล้วให้ `npm run lint` รันทั้ง tsc และ eslint | 0.5-1 วัน |
| 5 | Medium | เพิ่ม CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, THIRD_PARTY_NOTICES.md (scrcpy Apache-2.0), docs/ARCHITECTURE.md, KNOWN_LIMITATIONS.md | 1-2 วัน |
| 6 | Medium | Repo hygiene: ลบ `.pnpm-store/`, `refs/`, `image_qr.png` ฯลฯ ออกจาก git และเพิ่มใน `.gitignore`; แก้ README (ชื่อ/เวอร์ชัน/Node requirement) | 0.5 วัน |
| 7 | Medium | เพิ่ม dependabot + `npm audit`/`cargo audit` ใน CI | 0.5 วัน |
| 8 | Medium | ถ้าสนใจ gaming: ยกระดับ `keymap-controller` เป็น mapping editor + profile schema (ยืม design จาก `src/input/MappingEngine.ts`, `docs/profile.schema.json` ของ reference; ตรวจ license MIT ก่อนนำโค้ดมาใช้) | 2-4 สัปดาห์ (ต้องมี input pipeline ใน embedded mirror) |
| 9 | Low | Pointer Lock/relative mouse ใน embedded mirror | 3-5 วัน |
| 10 | Low | Troubleshooting table (symptom→action) ใน GUIDE.md และ Diagnostics export | 1 วัน |
| 11 | Low | Hosted/PWA build ของ UI — ไม่แนะนำ เพราะสถาปัตยกรรม Tauri/Rust ต่างกัน | — |

## 7. สิ่งที่ตรวจสอบไม่ได้ / ข้อจำกัด
- ไม่ได้ clone/รัน reference repo; อ่านจาก README และ git tree ผ่าน GitHub API เท่านั้น (ไม่ได้อ่านซอร์สโค้ดภายใน จึงอ้างความสามารถตาม README และชื่อไฟล์).
- ไม่ได้รัน build/test ของทั้งสองโปรเจกต์ จึงไม่ยืนยันว่าผ่าน.
- ไม่ได้เปิดอ่านเนื้อหา `KeymapController.tsx`, `macro-recorder`, `preset-profiles`, GUIDE.md ในรายละเอียด; ข้อสรุปว่า mapping "พื้นฐานกว่า" เป็นข้อสันนิษฐานจากชื่อ/ขนาดโครงสร้าง.
- ไม่ได้ตรวจเนื้อ workflow ครบทุกบรรทัด (ดูเฉพาะ `run:`/`uses:`), และไม่ได้ตรวจ checksum logic ของการ update scrcpy.
- ไม่ได้อ่าน `.env` และ keystore ตามคำสั่ง.
