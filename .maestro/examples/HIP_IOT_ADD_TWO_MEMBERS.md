# ตัวอย่างเพิ่มสมาชิก 2 คนด้วย Data Source

ไฟล์ที่ใช้:

- Flow: `hip-iot-add-two-members.yaml`
- ข้อมูลตัวอย่าง: `../data/hip-iot-two-members.json`
- ข้อมูลจริงแบบ Smoke: `../local-data/hip-iot-audit-smoke-real.json`
- ข้อมูลจริงทั้งหมด: `../local-data/hip-iot-audit-pending-real.json`

## แก้ข้อมูลก่อนทดสอบ

ไฟล์ตัวอย่างเดิมใช้ชื่อบ้านเต็ม แต่ Flow รุ่นนี้ใช้ `BRANCH_CODE` regex แล้ว จึงไม่ต้องให้ชื่อใน Excel ตรงกับข้อความ UI ทั้งหมด

- `BRANCH_CODE` เป็นรหัส เช่น `WX0007`
- `BRANCH_NAME` ใช้ประกอบการตรวจสอบข้อมูลเท่านั้น
- `MEMBER_NAME` และ `MEMBER_ACCOUNT` ของสมาชิกทั้ง 2 คน

หากต้องการเพิ่มมากกว่า 2 คน ให้เพิ่ม object ใน `members` ได้ทันที โดยไม่ต้องแก้ YAML

## เปิด Flow

1. ไปที่ **Script Manager → Maestro Builder**
2. กด **Open YAML**
3. เลือก `.maestro/examples/hip-iot-add-two-members.yaml`
4. เลือกอุปกรณ์ที่จะรัน

## Map Data Source

1. กด **Data Source**
2. สำหรับการลองครั้งแรก เลือก `.maestro/local-data/hip-iot-audit-smoke-real.json`
3. เลือก **Run mode → Cross join**
4. เลือก **Primary Dataset → homes (1)**
5. เลือก **Additional Dataset → members (2)**

ชื่อคอลัมน์ใน JSON เป็นชื่อตัวแปรที่ถูกต้องอยู่แล้ว ระบบจึง Map ให้อัตโนมัติ:

| Dataset | Column | Maestro variable |
|---|---|---|
| homes | `BRANCH_CODE` | `BRANCH_CODE` |
| homes | `BRANCH_NAME` | `BRANCH_NAME` |
| members | `MEMBER_NAME` | `MEMBER_NAME` |
| members | `MEMBER_ACCOUNT` | `MEMBER_ACCOUNT` |

ไฟล์ Smoke ควรแสดง `1 primary × 2 additional` และ `2 total runs` เมื่อยืนยัน selector แล้วจึงเปลี่ยนเป็น `hip-iot-audit-pending-real.json` สำหรับรายการจริงทั้งหมด

Flow ค้นหาสาขาด้วย regex `^${BRANCH_CODE}($|\\s|_).*` ตัวอย่างเช่น `WX0007` จะตรงกับ `WX0007`, `WX0007 012...` และ `WX0007_12...`

## ยืนยันบนอุปกรณ์จริงแล้ว: ใช้ "คัดลอก" ไม่ใช่กรอกอีเมล

เดิม flow นี้กรอกอีเมล/ชื่อผ่าน resource-id แบบเดา (`.*(email|account|username).*` ฯลฯ) แล้วกดปุ่มยืนยัน — **ทดสอบบนอุปกรณ์จริงแล้วว่าใช้ไม่ได้**: ช่อง "เลขบัญชี" ในฟอร์ม "App account" ต้องการเลขบัญชีภายในระบบ ไม่ใช่อีเมล ลองแล้วทั้งอีเมลจริง (`Auditkulrat.l@laundry-you.com`) และอีเมลปลอมได้ error "Unable to add the account" เหมือนกันทั้งคู่ และตรวจสอบรายชื่อสมาชิกแล้วว่าไม่มีการเพิ่มจริง

Flow เวอร์ชันนี้เปลี่ยนไปกดปุ่ม **"คัดลอก"** ในกล่อง Share แทน ซึ่งยืนยันแล้วว่าใช้ได้จริง: ไม่ต้องพิมพ์อะไร กดแล้วระบบสร้างคำเชิญทันที (ปรากฏเป็น "New member / รอให้เข้าร่วม" อายุ 3 วัน) และคัดลอกลิงก์เชิญไว้ที่คลิปบอร์ด

**ข้อจำกัดที่ยังไม่แก้:** คำเชิญที่สร้างด้วย "คัดลอก" เป็นคำเชิญทั่วไป (role Common Member) ไม่ผูกกับ `MEMBER_ACCOUNT` จนกว่าผู้รับจะเปิดลิงก์เองแล้วล็อกอินด้วยอีเมลนั้น ดังนั้น flow นี้สร้างลิงก์เชิญ 2 ลิงก์ต่อสาขา (หนึ่งลิงก์ต่อสมาชิกหนึ่งคนใน cross join) แต่ยังไม่ได้ส่งลิงก์แต่ละอันไปหา `MEMBER_ACCOUNT` ที่ตรงกันให้อัตโนมัติ — `MEMBER_NAME`/`MEMBER_ACCOUNT` ใน env ตอนนี้ใช้เพื่อตั้งชื่อไฟล์ screenshot และเป็นข้อมูลอ้างอิงสำหรับส่งลิงก์ต่อเองเท่านั้น

## ลำดับการทำงาน

แต่ละรอบจะเปิดแอปใหม่ เข้า Home Management เลือกบ้านตาม `BRANCH_CODE` เปิด "เพิ่มสมาชิก" กด "คัดลอก" ตรวจว่าคำเชิญขึ้นในรายการสมาชิก (รอให้เข้าร่วม) และเก็บ Screenshot ดังนั้นข้อมูลตัวอย่างนี้จะทำงานทั้งหมด 2 รอบ—หนึ่งรอบต่อสมาชิกหนึ่งคน (สร้างคำเชิญ 2 ลิงก์แยกกัน)

โฟลเดอร์ `.maestro/local-data/` ถูก Git ignore เพราะมีอีเมลจริง ห้ามย้ายไฟล์ข้อมูลจริงไปยังโฟลเดอร์ที่ commit ขึ้น repository
