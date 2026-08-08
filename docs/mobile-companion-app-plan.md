# แผน: Mobile Companion App สำหรับ scrcpy-gui-plus

เอกสารแผนงานเบื้องต้น — ยังไม่ลงมือเขียนโค้ดใดๆ ทั้งสิ้น เก็บไว้ทบทวนก่อนตัดสินใจเริ่ม

## เป้าหมาย

ให้ผู้ใช้ควบคุมแอป desktop และ/หรือ mirror หน้าจอมือถือได้ แม้ไม่มี USB และเครื่องไม่รองรับ
wireless debugging (Android < 11) โดยไม่พึ่ง ADB เลย

## สถานะปัจจุบัน (ก่อนเริ่มงานนี้)

- แอป desktop (Tauri) เชื่อมต่อมือถือผ่าน `adb`/`scrcpy` binary เท่านั้น (USB, wireless pairing
  code, QR code แบบ native ของ Android, mDNS/subnet scan) — ดู
  `src/components/wireless-pairing-wizard/`, `src-tauri/src/commands.rs`
- **ไม่มี** local server/socket ฝั่ง desktop ที่รับ connection จากภายนอกได้เลย ทุกอย่างเป็นการ
  shell out ไปเรียก adb/scrcpy แบบ local
- QR code ที่มีอยู่ตอนนี้ (`generate_pairing_qr`) เป็น payload มาตรฐาน Android WiFi/ADB pairing
  (`WIFI:T:ADB;S:...;P:...;;`) ให้ scanner ของ Android เองอ่าน ไม่ใช่ protocol ของเราเอง

## สถาปัตยกรรมที่ต้องเพิ่ม (ถ้าจะทำ)

### ฝั่ง Android Companion App (โปรเจกต์ใหม่แยกต่างหาก)
- `MediaProjection` API + `MediaCodec` (H.264/H.265 hardware encoder) สำหรับ capture หน้าจอ —
  ทำงานได้ทุกเวอร์ชัน Android ไม่ต้อง USB/ADB
- `AccessibilityService` สำหรับ inject touch/swipe/key แทนคำสั่ง `adb shell input`
- Foreground service ค้าง notification ตลอดเวลาที่ capture (ข้อบังคับของ Android)
- Network client ต่อ WebSocket/WebRTC ไปยัง desktop เพื่อส่งวิดีโอ + รับคำสั่งควบคุม
- ใช้ Android NSD (mDNS มาตรฐาน) เพื่อ scan หา desktop บน LAN

### ฝั่ง Desktop (Tauri/Rust) — ส่วนที่ต้องเพิ่มใหม่
- Local WebSocket/TCP server (เช่น `tokio-tungstenite` หรือ `axum` ws) — ยังไม่มีอยู่เลยตอนนี้
- mDNS advertisement ของ service type ตัวเอง (เช่น `_scrcpy-gui-plus._tcp`)
- Pairing ด้วย QR code + token ครั้งเดียว (ต่อยอดจาก `qrcode` crate ที่มีอยู่แล้ว)
- Video decode pipeline รับ H.264 stream มาแสดงผล (เช็คว่า decoder ที่ใช้กับ scrcpy ตอนนี้
  reuse ได้แค่ไหน)
- Input forwarding: จับ mouse/keyboard จาก `ControlPanel` เดิม ส่งกลับไปมือถือแทนที่จะยิงผ่าน
  `adb shell input`

### จุดออกแบบสำคัญ
- ทำ abstraction layer ให้ `DeviceDisplay`/`ControlPanel` ไม่ต้องรู้ว่าหลังบ้านเป็น ADB
  transport หรือ Companion-app transport เพื่อ reuse UI เดิมได้ทั้งสองโหมด
- ต้องมี token/PIN pairing + แนะนำ TLS (self-signed + pin ตอน pairing) กัน device แปลกหน้า
  บน network เดียวกันเชื่อมเข้ามา
- ขอบเขตเครือข่าย: เริ่มจาก LAN-only ผ่าน mDNS ก่อน ยังไม่ทำ relay/TURN สำหรับต่อข้ามเน็ต

## สิ่งที่จะทำต่อ (ถัดไป เมื่อพร้อมเริ่ม)

1. Desktop: เพิ่ม WebSocket server + mDNS advertise + QR pairing (ยังไม่ต้องมีวิดีโอ แค่
   handshake/pairing ให้ทำงานก่อน)
2. Android: scaffold แอปใหม่ ทำ capture → encode → stream วิดีโอเข้ามาโชว์ใน `DeviceDisplay`
   เดิม (mirror อย่างเดียว ยังไม่ต้องควบคุม) — milestone นี้พิสูจน์ pipeline หลักก่อน
3. เพิ่ม `AccessibilityService` + ต่อ input event จาก `ControlPanel` กลับไปมือถือ
4. Harden security (token expiry, TLS, reconnect handling)
5. รองรับหลายอุปกรณ์ให้สอดคล้องกับ device list ที่มีอยู่

## สิ่งที่ยังไม่ต้องทำตอนนี้ (out of scope)

- ต่อข้ามเน็ตนอก LAN (relay/TURN server, NAT traversal เต็มรูปแบบ) — รอจน LAN-only ทำงานดีก่อน
- iOS companion app — โฟกัส Android ก่อน เพราะ use case คือควบคุม/มิเรอร์อุปกรณ์ Android
- เผยแพร่ Android companion app ขึ้น Play Store — ใช้ sideload/internal build พอสำหรับช่วง
  พิสูจน์แนวคิด
- รวม/แทนที่ ADB transport เดิม — สองโหมดต้องอยู่คู่กัน ไม่ใช่แทนที่กัน
- ปรับ UI/UX ของ `ControlPanel`, `DeviceDisplay` เพื่อรองรับ multi-transport แบบสวยงาม — รอจน
  transport abstraction ทำงานได้จริงก่อนค่อย polish

## คำถามเปิดที่ต้องตัดสินใจก่อนเริ่มลงมือ

- จะใช้ WebSocket หรือ WebRTC สำหรับ video stream? (WebRTC latency ต่ำกว่า แต่ signaling ซับซ้อนกว่า)
- decoder ฝั่ง desktop ที่ใช้กับ scrcpy ตอนนี้คือตัวไหน reuse กับ H.264 จาก MediaProjection ได้เลยไหม
- จะเริ่มจากฝั่ง desktop server ก่อน หรือ scaffold Android app ก่อน
