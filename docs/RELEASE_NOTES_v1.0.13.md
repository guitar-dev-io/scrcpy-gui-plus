# Mobile Device Studio v1.0.13

วันที่เผยแพร่: 26 สิงหาคม 2569

## Script Manager / Maestro Builder

- เพิ่มการสร้างและแก้ไข Maestro YAML จาก Script Manager
- เพิ่ม Save, Save As, Open YAML และ Open Flow Folder
- รัน Flow จากไฟล์ YAML ที่บันทึกไว้ และแสดงตำแหน่งไฟล์ในหน้า Builder
- รักษาคำสั่ง Maestro ขั้นสูงที่ Visual Builder ยังไม่รองรับไว้เป็น Raw YAML

## Data-driven Automation

- อ่านข้อมูลทั่วไปจาก Excel `.xlsx`, CSV `.csv`, TSV `.tsv` และ JSON `.json`
- เลือก Dataset/Sheet และจับคู่คอลัมน์เป็น Maestro variables
- กรองรายการก่อนรันและแสดงตัวอย่างข้อมูล
- ใส่ข้อมูลแต่ละรายการผ่าน Maestro `env` อย่างปลอดภัย
- แสดง Resolved YAML ก่อนรันจริง
- รองรับ Single Dataset และ Cross Join หลาย Dataset
- ตรวจ Variable ซ้ำและจำกัด Cross Join สูงสุด 10,000 งานต่อ Batch
- สรุปจำนวน Passed, Failed และ Not Run หลังจบ Batch

## การตรวจสอบ

- Frontend tests 498 รายการผ่าน
- TypeScript check และ Production build ผ่าน
- Rust automation data tests ผ่าน
- ตรวจการจัดวางหน้า Script Manager ที่ความละเอียด 1280 × 720 แล้ว

## งานระยะถัดไป

- Retry, Continue, Pause, Resume และ Checkpoint
- Export ผลลัพธ์และเขียนผลกลับไฟล์ต้นทางโดยสร้าง Backup ก่อน
- Derived Variables, หลาย Filter และ Lookup Join

