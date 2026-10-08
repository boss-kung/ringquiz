# Treasure Quiz: เกมตอบคำถาม สะสมทรัพยากร และเปิดหีบรางวัล

วันที่: 8 ตุลาคม 2026  
สถานะ: Design approved; รอผู้ใช้รีวิว written spec  
ชื่อใช้งานในสเปก: **Treasure Quiz**

## 1. เป้าหมาย

สร้างเว็บเกมใหม่สำหรับผู้เล่นสองบทบาท:

- **Game Master (Host):** ผู้ตั้งคำถาม เตรียมรางวัล สร้างห้อง และควบคุมจังหวะเกม
- **Contestant (Player):** ผู้เข้าแข่งขันเพียงหนึ่งคน เล่นจากมือถืออีกเครื่องหนึ่ง

ทั้งสองเครื่องเชื่อมต่อแบบ Realtime เกมประกอบด้วย 8 รอบของการตอบคำถามที่ยากขึ้นตามลำดับ ผู้เล่นเห็น keywords ของชุดคำถามก่อนเลือกเดิมพัน เล่นเพื่อสะสมทองและเพชร จากนั้นใช้ทรัพยากรทั้งหมดซื้อและเปิดหีบรางวัลหลายใบ เงินรางวัลจากหีบถูกเก็บเป็นยอดเงินบาทถาวรและนำไปแลกรางวัลจริงภายหลัง

Treasure Quiz เป็นเว็บและ deployment แยกจาก RingQuiz แต่ใช้ Supabase project เดียวกัน ตาราง ฟังก์ชัน และ Realtime channel ใหม่ต้องใช้ prefix `tq_` หรือ `treasure-` เพื่อไม่ชนหรือเปลี่ยนพฤติกรรมของ RingQuiz

## 2. หลักการออกแบบ

1. ผู้เล่นต้องมี agency จากสามจุด: เลือกเดิมพัน เลือกซื้อ Event และเลือกชุดหีบ
2. Game Master ควบคุมจังหวะและเนื้อหา แต่ไม่สามารถกำหนดผลสุ่มย้อนหลังได้
3. ทองและเพชรเป็นทรัพยากรชั่วคราวของเกมหนึ่งครั้ง ส่วนเงินบาทเป็นรางวัลถาวร
4. เงินบาทที่ชนะแล้วเพิ่มขึ้นจากหีบเท่านั้น นำกลับมาเดิมพันหรือซื้อทรัพยากรในเกมไม่ได้
5. ไม่มีการซื้อทอง เพชร หรือสิทธิ์เล่นด้วยเงินจริง
6. การตรวจคำตอบ การจ่ายรางวัล การสุ่มหีบ และการแก้ยอดเงินทำบน Supabase ฝั่งเซิร์ฟเวอร์
7. UX หลักเป็นมือถือแนวตั้ง ใช้ข้อความไทย ปุ่มกดขนาดใหญ่ และแสดงสถานะสำคัญโดยไม่พึ่งสีเพียงอย่างเดียว

## 3. ขอบเขต MVP

### รวมใน MVP

- Game Master หนึ่งคนและ Contestant หนึ่งคนต่อห้อง
- ห้องชั่วคราวพร้อมรหัส 4 ตัวและ QR Code
- 8 รอบตามโครงสร้างคงที่ในสเปกนี้
- คำถาม 4 กลไก: ใช่/ไม่ใช่, 3 ตัวเลือก, 3 ตัวเลือกแบบ time bank และ 4 ตัวเลือกแบบ no-mistake
- Preview keywords และระดับความยากก่อนเดิมพัน
- เดิมพัน 3 ระดับ: Safe, Gold และ Diamond
- Event checkpoint หลังรอบ 2, 4 และ 6
- หีบหลายระดับ ซื้อได้หลายใบ และกลไกใช้ทอง/เพชรให้หมด
- Prize inventory แบบ finite bag
- Wallet เงินบาทถาวรและประวัติ ledger
- Reward catalog และ flow ขอแลก/อนุมัติ/ส่งมอบ
- กลับเข้าเกมเดิมได้หลัง refresh หรือการเชื่อมต่อหลุด
- Game Master ช่วย link โปรไฟล์เดิมไปยังอุปกรณ์ใหม่ได้

### ไม่รวมใน MVP

- ห้องที่มี Contestant มากกว่าหนึ่งคน
- การซื้อทรัพยากรด้วยเงินจริง
- การโอนเงินบาทสะสมระหว่างผู้เล่น
- การจ่ายเงินผ่านธนาคารอัตโนมัติ
- ระบบ leaderboard สาธารณะ
- การสร้างคำถามด้วย AI
- คำถาม free-text ที่ต้องให้ Host ตัดสินถูกผิด
- แอป native iOS/Android

## 4. บทบาทและสิทธิ์

### Game Master

- เข้าหน้าควบคุมด้วย Host secret ที่ตรวจใน Edge Function และเก็บเฉพาะ `sessionStorage`
- จัดการคลังคำถาม ชุดคำถาม Prize inventory และ Reward catalog
- สร้างห้อง เริ่ม/พัก/ดำเนินเกมต่อ เปิดเฉลย และไปยังรอบถัดไป
- ดูสถานะ Contestant แบบ Realtime แต่แก้คำตอบหรือผลสุ่มไม่ได้
- อนุมัติ ปฏิเสธ และทำเครื่องหมายว่าได้ส่งมอบรางวัลแล้ว
- ออก one-time pairing code สำหรับเชื่อมโปรไฟล์เดิมกับอุปกรณ์ใหม่

### Contestant

- ใช้ Supabase Anonymous Auth บนอุปกรณ์ประจำ
- เข้าห้องด้วยรหัส 4 ตัวและชื่อเล่น
- เห็น briefing และ keywords ก่อนเลือกเดิมพัน
- ส่งคำตอบ เลือก Event เลือกหีบ และขอแลกรางวัล
- อ่านได้เฉพาะข้อมูลห้องที่ตนเข้าร่วม คำตอบของตน Wallet ของตน และข้อมูล catalog ที่เปิดใช้งาน

### การกู้คืนตัวตน

Wallet มีมูลค่าจริงจึงห้ามผูกกับ `localStorage` เพียงอย่างเดียว โปรไฟล์ผู้เล่นมี UUID ถาวรแยกจาก anonymous auth user ID อุปกรณ์เดิมกลับมาได้จาก Supabase session หากเปลี่ยนอุปกรณ์ Game Master ออก pairing code แบบใช้ครั้งเดียวซึ่งหมดอายุใน 10 นาทีสำหรับโปรไฟล์นั้น แล้ว Edge Function ตรวจ code และย้ายการผูก auth UID ไปยังอุปกรณ์ใหม่ ทุกการย้ายต้องบันทึก audit event

## 5. Flow ก่อนเริ่มเกม

1. Game Master เตรียมคำถาม โดยทุกข้อมีโจทย์ คำตอบ ตัวเลือก keyword ระดับความยาก และสถานะเผยแพร่
2. Game Master เติมจำนวน ticket ใน Prize inventory ของแต่ละระดับหีบ
3. Game Master ตรวจ maximum outstanding liability ซึ่งเท่ากับผลรวม `เงินรางวัล × ticket ที่เหลือ`
4. Game Master จัดการ Reward catalog เช่น เงินสด 100 บาท หรือบุฟเฟต์สุกี้ 250 บาท
5. Game Master สร้างห้อง ระบบ snapshot กฎรอบ ราคา Event ราคาหีบ และ question pack ลงในห้อง
6. ระบบสร้างรหัสห้อง 4 ตัวที่ไม่ซ้ำกับห้องซึ่งยัง active พร้อม QR Code รหัสหมดอายุเมื่อห้องจบหรือ 24 ชั่วโมงหลังสร้าง แล้วแต่ว่าอย่างใดเกิดก่อน
7. Contestant เข้าห้อง ระบบผูก profile กับห้องและแสดงสถานะ Ready
8. เมื่อทั้งสองเครื่องเชื่อมต่อ Game Master กดเริ่ม
9. Contestant เริ่มเกมด้วย 200 ทองและ 0 เพชร

หลังเริ่มเกม snapshot ของกฎ ราคา และคำถามสำหรับห้องนั้นแก้ไม่ได้ การเปลี่ยน template มีผลกับห้องที่สร้างใหม่เท่านั้น

## 6. โครงสร้าง 8 รอบ

| รอบ | รูปแบบ | จำนวน | เวลา | รางวัลพื้นฐาน | โบนัส | Achievement เพชร |
|---|---|---:|---:|---:|---|---|
| 1 | ใช่/ไม่ใช่ | 10 ข้อ | ข้อละ 10 วินาที | 15 ทอง/ข้อถูก | Perfect +50 ทอง | ไม่มี |
| 2 | ใช่/ไม่ใช่ | 10 ข้อ | ข้อละ 10 วินาที | 15 ทอง/ข้อถูก | Perfect +50 ทอง | ถูกอย่างน้อย 9/10 ได้ 1 เพชร |
| 3 | 3 ตัวเลือก | 5 ข้อ | ข้อละ 10 วินาที | 40 ทอง/ข้อถูก | Perfect +50 ทอง | ไม่มี |
| 4 | 3 ตัวเลือก | 5 ข้อ | ข้อละ 10 วินาที | 50 ทอง/ข้อถูก | Perfect +50 ทอง | ถูก 5/5 ได้ 1 เพชร |
| 5 | 3 ตัวเลือกแบบ time bank | 5 ข้อ | รวม 30 วินาที | 50 ทอง/ข้อถูก | เมื่อถูกอย่างน้อย 4/5: เวลาที่เหลือ ×5 ทอง | ไม่มี |
| 6 | 3 ตัวเลือกแบบ time bank | 5 ข้อ | รวม 30 วินาที | 60 ทอง/ข้อถูก | เมื่อถูก 5/5: เวลาที่เหลือ ×10 ทอง | ถูก 5/5 และเหลืออย่างน้อย 10 วินาที ได้ 1 เพชร |
| 7 | 4 ตัวเลือกแบบ no-mistake | สูงสุด 5 ข้อ | ข้อละ 15 วินาที | 60 ทอง/ข้อถูก | ผ่าน 5/5 เพิ่ม 250 ทอง | ผ่าน 5/5 ได้ 1 เพชร |
| 8 | 4 ตัวเลือกแบบ no-mistake | สูงสุด 5 ข้อ | ข้อละ 15 วินาที | 80 ทอง/ข้อถูก | ผ่าน 5/5 เพิ่ม 400 ทอง | ผ่าน 5/5 ได้ 2 เพชร |

ค่าตารางนี้เป็น economy baseline สำหรับ MVP และต้องผ่าน simulation/test play ก่อน production แต่พฤติกรรมของแต่ละรอบเป็นข้อกำหนดคงที่

### Time bank

- เวลา 30 วินาทีเริ่มนับเมื่อเปิดข้อแรกและไม่ reset ระหว่างข้อ
- ผู้เล่นเลือกคำตอบแล้วไปข้อต่อไปทันที
- หมดเวลาเมื่อใด ระบบปิดชุดคำถามทันที
- Server timestamp เป็นแหล่งเวลาหลัก
- Time bonus ใช้จำนวนวินาทีเต็มที่เหลือจาก server deadline และจ่ายเมื่อผ่านเงื่อนไขของรอบเท่านั้น

### No-mistake

- เมื่อตอบผิดหรือหมดเวลา รอบจบทันที
- ทองพื้นฐานจากข้อที่ตอบถูกก่อนหน้ายังคงได้
- Perfect bonus และ Achievement เพชรจะไม่ได้รับ
- เอฟเฟกต์ `mistake_shield` สามารถป้องกันความผิดพลาดครั้งแรกหนึ่งครั้ง แล้วถูกใช้ทิ้ง

## 7. Briefing และ keywords

ก่อนเดิมพัน ระบบแสดง:

- หมายเลขรอบและชื่อรูปแบบ
- จำนวนคำถามและกติกาเวลา
- ระดับความยาก 1–3 ดาว
- keyword หนึ่งรายการต่อหนึ่งคำถาม เรียงตามลำดับแบบสุ่มที่ไม่ผูกกับลำดับคำถามจริง
- เป้าหมายที่ต้องผ่านสำหรับ Gold/Diamond bet
- ยอดทองและเพชรปัจจุบัน

Keyword ต้องบอกหัวข้อโดยไม่เปิดเผยข้อความโจทย์ คำตอบ หรือตัวเลือก เช่น `ญี่ปุ่น`, `แมว`, `เพลงยุค 90` ใช้ได้ แต่ `โตเกียวคือเมืองหลวง` ใช้ไม่ได้

เดิมพันหนึ่งครั้งต่อรอบ ไม่เดิมพันแยกทุกข้อ

## 8. ระบบเดิมพัน

### Safe

- Stake: 0
- ได้ทองพื้นฐานและโบนัสปกติ
- ไม่มีบทลงโทษเพิ่มเติม

### Gold bet

- Stake: 100 ทอง หักเมื่อยืนยัน
- เป้าหมายรอบ 1–2: ถูกอย่างน้อย 8/10
- เป้าหมายรอบ 3–4: ถูกอย่างน้อย 4/5
- เป้าหมายรอบ 5–6: ถูกอย่างน้อย 4/5 ก่อนหมดเวลา
- เป้าหมายรอบ 7–8: ถูก 5/5
- หากผ่าน: คืน stake และเพิ่มโบนัสเท่ากับ 50% ของทองพื้นฐานหลังปัดลง
- หากไม่ผ่าน: stake ถูกริบ แต่ยังได้รับทองพื้นฐานและโบนัสรอบตามปกติ

### Diamond bet

- Stake: 1 เพชร หักเมื่อยืนยัน
- ใช้เป้าหมายเดียวกับ Gold bet
- หากผ่าน: คืนเพชรและเพิ่มโบนัสเท่ากับ 100% ของทองพื้นฐาน
- หากไม่ผ่าน: เพชรถูกริบ แต่ยังได้รับทองพื้นฐานและโบนัสรอบตามปกติ

การวางเดิมพันต้องเป็นคำสั่งแบบ idempotent และแก้ไม่ได้หลัง Host เปิดคำถามข้อแรกของรอบ

## 9. Flow หนึ่งรอบ

1. Host เปิด briefing ของรอบ
2. Contestant เห็น keywords และเลือก Safe, Gold หรือ Diamond bet
3. Server ตรวจยอดและล็อก stake
4. Host กดเริ่ม ระบบกำหนด authoritative deadline
5. Contestant ตอบคำถามตามกลไกรอบ
6. Server รับคำตอบแต่ละข้อเพียงครั้งเดียว ตรวจ deadline และคำนวณความถูกต้อง
7. เมื่อจบรอบ Server คำนวณ base reward, round bonus, achievement และ bet settlement ใน transaction เดียว
8. Host กดเปิดผล ทั้งสองหน้าจอเห็นผลและยอดทรัพยากรใหม่
9. ถ้าเป็นรอบ 2, 4 หรือ 6 ไป Event checkpoint มิฉะนั้นไปรอบถัดไป

ลำดับคำนวณทองคือ base reward → round bonus → Event reward boost → bet bonus → stake refund โดย `reward_boost_20` คิด 20% จากผลรวม base reward และ round bonus หลังปัดลง ส่วน Gold/Diamond bet bonus คิดจาก base reward เท่านั้น จึงไม่มี multiplier ซ้อน multiplier

## 10. Event checkpoint

หลังรอบ 2, 4 และ 6 Contestant เลือกได้หนึ่งทาง:

- Skip: ไม่เสียทรัพยากร
- Gold Event: 150 ทอง
- Diamond Event: 1 เพชร

Server หักราคาและสุ่มการ์ดจาก event deck แบบ idempotent การ์ดใช้ได้ทันทีหรือสร้าง effect ที่มีวันหมดอายุชัดเจน ผลขั้นต่ำของ MVP:

- `reward_boost_20`: เพิ่มทองจากสองรอบถัดไป 20%
- `extra_keyword`: เปิด supplementary keyword เพิ่มให้หนึ่งคำถามในรอบถัดไป
- `bet_shield`: ป้องกันการเสีย stake ครั้งถัดไป
- `mistake_shield`: ป้องกันคำตอบผิดครั้งแรกใน no-mistake round แล้วให้เล่นต่อ
- `chest_discount_100`: ผู้เล่นเลือกหีบหลักหนึ่งใบในตะกร้าให้ลดราคาทอง 100 ทอง แต่ไม่ต่ำกว่า 0; ใช้กับ Closeout/Consolation ไม่ได้
- `extra_time_5`: เพิ่ม 5 วินาทีต่อข้อสำหรับรอบ per-question หรือเพิ่ม 5 วินาทีให้ time bank
- `tax_50`: เสีย 50 ทอง แต่ยอดไม่ติดลบ
- `boss_question`: เปิดคำถาม 10 วินาทีหนึ่งข้อ ตอบถูกได้ 500 ทอง ตอบผิดไม่เสียเพิ่ม

Gold Event ใช้เฉพาะชุดผลกระทบความเสี่ยงต่ำ ส่วน Diamond Event ใช้ชุดผลกระทบมูลค่าสูงและมีทั้งผลบวก/ลบที่แรงกว่า Host ไม่เห็นผลล่วงหน้าและเปลี่ยนผลไม่ได้

## 11. Prize Shop และหีบ

หลังรอบ 8 ระบบปิดการเดิมพันและ Event แล้วเปิด Prize Shop Contestant เลือกประเภทและจำนวนหีบได้หลายใบ ระบบแสดงตะกร้าและทรัพยากรคงเหลือแบบทันที

| หีบ | ราคา | เงินรางวัลที่อนุญาตใน inventory |
|---|---:|---|
| ทองแดง | 100 ทอง | 1, 10, 50 สตางค์ |
| เงิน | 300 ทอง | 50, 100, 200 สตางค์ |
| ทอง | 700 ทอง + 1 เพชร | 100, 200, 500, 1,000 สตางค์ |
| เพชร | 1,500 ทอง + 3 เพชร | 500, 1,000, 2,000, 5,000, 10,000 สตางค์ |
| คริสตัลเล็ก | 1 เพชร | 10, 50, 100 สตางค์ |

ราคานี้เป็น baseline ที่ต้องปรับจาก simulation/test play ก่อน production ส่วนจำนวนเงินจริงและ ticket count ตั้งได้จาก Host inventory โดยค่ารางวัลต่ำสุดของหีบระดับสูงต้องไม่น้อยกว่าค่าต่ำสุดของระดับก่อนหน้า

### ใช้ทรัพยากรให้หมด

1. Contestant ซื้อหีบหลักได้หลายใบ
2. หากมีทองอย่างน้อย 100 สามารถซื้อหีบทองแดงต่อจนเหลือน้อยกว่า 100
3. เพชรที่เหลือทุกเม็ดซื้อหีบคริสตัลเล็กได้
4. หลังมีหีบหลักในตะกร้าแล้ว หากเหลือทอง 1–99 หรือไม่มีหีบทองที่มี inventory พอขาย ระบบเพิ่ม Closeout Chest ซึ่งใช้ทองที่เหลือทั้งหมดและให้ 1 สตางค์
5. หากไม่มีทรัพยากรพอซื้อหีบใดเลย ระบบให้ Consolation Chest ฟรีมูลค่า 1 สตางค์หนึ่งใบ
6. การยืนยันตะกร้าต้องทำให้ทองและเพชรเหลือศูนย์ มิฉะนั้น Server ปฏิเสธและส่งชุดการซื้อที่ใช้ทรัพยากรหมดเป็นคำแนะนำ

### การซื้อและเปิด

- การยืนยันตะกร้าหักทอง/เพชร สุ่มและกัน prize ticket จาก inventory และสร้าง chest purchase rows ใน transaction เดียว ผลที่กันไว้เก็บในตาราง private ที่ให้ service role อ่านได้เท่านั้นจนกว่าจะเปิด
- Contestant เปิดทีละใบหรือเปิดทั้งหมดได้ การเปิดเป็นการ reveal ผลที่ถูกกันไว้และเพิ่ม Wallet จึงไม่มีความเสี่ยงว่า inventory จะหมดหลังซื้อแล้ว
- การยืนยันตะกร้าและการเปิดแต่ละใบมี idempotency key ป้องกันการกดซ้ำหรือ network retry
- ผลแสดงพร้อมกันบน Host และ Contestant
- หากออกจากเกมหลังซื้อแต่ก่อนเปิด การกลับเข้าระบบต้องพาไปยังหีบที่ยังไม่เปิดก่อนทำกิจกรรมอื่น

## 12. Finite prize bag และการควบคุมงบ

แต่ละระดับหีบมี Prize inventory เป็น ticket จริง เช่น `500 สตางค์ × 10 ใบ` และ `5,000 สตางค์ × 1 ใบ` จำนวน ticket เป็นน้ำหนักการสุ่ม Prize pool ใช้ versioning: ห้องอ้างอิง pool version ตอนสร้างห้อง และ version นั้นแก้จำนวนหรือมูลค่า ticket ไม่ได้ขณะห้องยัง active การเติมหรือเปลี่ยนรางวัลต้องสร้าง pool version ใหม่สำหรับห้องถัดไป

เมื่อยืนยันตะกร้า Server:

1. lock แถว inventory ที่ยังมีจำนวนเหลือ
2. สุ่ม ticket จากจำนวนที่เหลือ
3. ลด `remaining_quantity`
4. บันทึก reward ที่กันไว้ในตาราง private ซึ่งไม่มี grant ให้ client roles; `tq_chest_purchases` เก็บเพียงสถานะ `purchased`
5. commit การซื้อทั้งหมดพร้อมกัน หรือ rollback ทั้งตะกร้า

เมื่อเปิดหีบ Server อ่าน reward จากตาราง private, คัดลอกจำนวนเงินไปยังผลที่เปิดเผยใน `tq_chest_purchases`, สร้าง Wallet ledger และเพิ่ม balance ใน transaction เดียว ผลจึงไม่เปลี่ยนตามเวลาที่เปิด แต่ไม่มี client ใดรู้ผลก่อนเปิด

หากระดับหีบไม่มี inventory เหลือ หีบนั้นต้องถูกปิดการขายก่อนยืนยันตะกร้า ห้าม resample ไปยัง tier อื่นโดยเงียบ ๆ

Host dashboard แสดง:

- จำนวน ticket เริ่มต้นและคงเหลือ
- มูลค่า liability สูงสุดที่ยังเหลือ
- มูลค่าที่จ่ายแล้วในรอบเดือน
- tier ที่ใกล้หมด

การสุ่มเป็นแบบ server-side และ Host ไม่สามารถลบหรือแก้ chest draw ที่สำเร็จแล้ว

## 13. Wallet เงินบาท

เงินบาทเก็บเป็น integer หน่วยสตางค์เท่านั้น เช่น 1 บาทคือ `100` และ 250 บาทคือ `25000`

Wallet ใช้ immutable ledger เป็นหลัก ทุก entry มี:

- `player_profile_id`
- `amount_satang` เป็นบวกหรือลบ
- `transaction_type`
- `reference_type` และ `reference_id`
- `idempotency_key`
- `created_at`
- `created_by`

ยอดคงเหลือ cache ใน wallet row เพื่ออ่านเร็ว แต่ทุกการเปลี่ยนต้องอัปเดต ledger และ balance ใน database transaction เดียวกัน ยอดต้องไม่ติดลบ

ประเภท ledger ขั้นต่ำ:

- `chest_reward`
- `redemption_reserve`
- `redemption_refund`
- `host_adjustment` ซึ่งต้องมีเหตุผลและ audit log

## 14. Reward catalog และ redemption

Reward catalog รองรับ `cash` และ `experience` เช่น:

- เงินสด 100 บาท ราคา 10,000 สตางค์
- บุฟเฟต์สุกี้ ราคา 25,000 สตางค์

Flow:

1. Contestant เลือกรางวัลและกดยืนยัน
2. Server ตรวจยอด สร้าง redemption สถานะ `requested` และ ledger `redemption_reserve` ติดลบใน transaction เดียว
3. Host เลือก `approve` หรือ `reject`
4. หาก reject หรือยกเลิกตามกติกา Server สร้าง `redemption_refund` และคืนยอด
5. หาก approve สถานะเป็น `approved` โดยไม่หักเงินซ้ำ
6. หลังมอบเงินจริงหรือประสบการณ์ Host เปลี่ยนสถานะเป็น `fulfilled`

สถานะที่อนุญาต:

`requested → approved → fulfilled`  
`requested → rejected`  
`requested|approved → cancelled` เฉพาะ Host และต้องคืนยอดหากยังไม่เคยคืน

ทุก transition ต้องตรวจสถานะเดิม ป้องกันการทำซ้ำ และเขียน audit event

## 15. Data model ใน Supabase

ตารางใหม่ทุกตารางใช้ prefix `tq_`:

- `tq_player_profiles`: ตัวตนถาวร ชื่อ และ auth UID ปัจจุบัน
- `tq_profile_link_events`: audit การเชื่อมอุปกรณ์ใหม่
- `tq_question_sets`: ชุดคำถามที่เผยแพร่
- `tq_questions`: โจทย์ ประเภท ตัวเลือก คำตอบ keyword และ difficulty
- `tq_rooms`: รหัสห้อง สถานะ รอบปัจจุบัน snapshot config และผู้เล่น
- `tq_room_rounds`: สถานะ briefing/bet/open/settled และผลรวมแต่ละรอบ
- `tq_answers`: คำตอบรายข้อ authoritative deadline ความถูกต้อง และเวลาตอบ
- `tq_event_draws`: ประเภท Event ราคา ผล และสถานะ effect
- `tq_chest_types`: ราคาและช่วงรางวัลที่แสดง
- `tq_prize_pools`: version ของ finite prize bag และสถานะ locked/active
- `tq_prize_inventory`: จำนวน ticket เงินรางวัลต่อ tier และ pool version
- `tq_chest_purchases`: หีบที่ซื้อ เปิดแล้วหรือยัง และผลเงินที่ reveal
- `tq_chest_reward_reservations`: ผลที่กันไว้ก่อนเปิด; private table สำหรับ service role เท่านั้น
- `tq_wallets`: balance cache ต่อ profile
- `tq_wallet_transactions`: immutable ledger
- `tq_redemption_catalog`: รางวัลที่เปิดให้แลก
- `tq_redemptions`: คำขอและสถานะการส่งมอบ
- `tq_audit_events`: host actions และ security-sensitive changes

Foreign keys ต้องใช้ `ON DELETE RESTRICT` สำหรับ ledger, chest draw และ redemption เพื่อรักษาประวัติการเงิน ใช้ soft-delete/`is_active` สำหรับ catalog, question sets, chest types และ prize inventory

## 16. Server API และ Realtime

ลดจำนวน Edge Function ด้วยสอง entry points:

### `treasure-host-action`

ตรวจ Host secret และรองรับคำสั่ง:

- จัดการ question set, prize inventory และ redemption catalog
- create room, start, pause, resume, reveal, advance, cancel
- approve/reject/fulfill redemption
- issue profile pairing code
- host adjustment พร้อมเหตุผล

### `treasure-player-action`

ตรวจ Supabase JWT และรองรับคำสั่ง:

- join room และ restore session
- link profile ด้วย pairing code
- place bet
- submit answer
- buy/draw Event
- submit chest cart
- open chest/open all
- request redemption

Database RPC ที่ต้อง atomic รองรับการ settle รอบ, เปิดหีบ, ยืนยันตะกร้า และ reserve/refund redemption ฟังก์ชันทุกตัวรับ idempotency key

Realtime ใช้ channel แยกตาม room ID และ filter ตารางที่เกี่ยวข้อง ห้ามใช้ channel เดียวแบบ global เหมือน RingQuiz ผู้เล่น subscribe เฉพาะห้องของตนและ profile/wallet ของตน

## 17. Security และ RLS

- Client ไม่สามารถเขียนยอดทอง เพชร เงินบาท ผลคำตอบ ผล Event หรือผลหีบโดยตรง
- Client reads ถูกจำกัดด้วย RLS ตาม auth UID → player profile → active room
- คำตอบที่ถูกต้องและ Prize inventory ticket detail ไม่เปิดให้ Contestant อ่านก่อน settle/draw
- Host secret อยู่ใน Edge Function secret และ sessionStorage ฝั่ง Host เท่านั้น
- Edge Functions ตรวจ room status และ transition ที่อนุญาตทุกครั้ง
- Unique constraints ป้องกันคำตอบซ้ำต่อข้อ เดิมพันซ้ำต่อรอบ เปิดหีบซ้ำ และ ledger idempotency ซ้ำ
- ใช้ server time สำหรับ deadline ทั้งหมด
- ทอง เพชร และ wallet balance ต้องไม่ติดลบ
- Closeout/Consolation reward และ prize draw ต้องสร้าง ledger entry เสมอ

หากระบบถูกเปิดให้บุคคลทั่วไปหรือมีการเก็บค่าเข้าเล่น ต้องหยุดและตรวจข้อกำหนดทางกฎหมายก่อน เพราะ MVP นี้ออกแบบสำหรับเกมส่วนตัวที่ไม่มีการซื้อสิทธิ์หรือทรัพยากรด้วยเงินจริง

## 18. หน้าจอ

### Host

1. Host login
2. Dashboard: คำถาม, Prize inventory, Reward catalog, Wallet/redemptions
3. Create room และ Lobby พร้อม QR
4. Round control: briefing, bet status, timer, answer progress, reveal, advance
5. Event reveal
6. Prize Shop observer และ chest reveal
7. Redemption management

### Contestant

1. Join/profile restore
2. Lobby
3. Round briefing และ bet selection
4. Question runner ตามกลไกรอบ
5. Round result และทรัพยากร
6. Event checkpoint
7. Prize Shop พร้อม cart และ remaining resources
8. Chest opening
9. Wallet, history และ Reward catalog
10. Redemption status

## 19. Error handling และ recovery

- Refresh: โหลด room/profile/current phase จาก Server แล้วกลับหน้าที่ถูกต้อง
- Network loss ระหว่างตอบ: deadline ยังเดินต่อ การ reconnect ส่งได้เฉพาะถ้ายังไม่หมดเวลาและยังไม่มีคำตอบ
- Duplicate request: คืนผลเดิมจาก idempotency key
- Host หลุด: ห้อง pause ได้เฉพาะคำสั่ง Host เมื่อกลับมา; timer ที่เปิดอยู่ยังใช้ deadline เดิม
- Prize inventory หมดระหว่างจัดตะกร้า: transaction ปฏิเสธทั้งตะกร้าและให้เลือกใหม่
- Error ระหว่างเปิดหีบ: หาก DB transaction commit แล้ว retry ต้องคืนผลเดิม หากไม่ commit ต้องไม่มีการหักหีบหรือเพิ่ม Wallet บางส่วน
- Redemption transition ผิดลำดับ: ปฏิเสธโดยไม่แก้ ledger

## 20. การทดสอบและเกณฑ์ยอมรับ

### Unit tests

- Reward calculation ของทั้ง 8 รอบ
- Time-bank boundary และ rounding
- No-mistake termination และ Shield
- Gold/Diamond bet success/failure/refund
- Event effect expiry และ stacking
- Chest cart pricing, discount และ zero-resource invariant
- Wallet ledger และ redemption state machine

### Database/Edge integration tests

- ตอบซ้ำ เดิมพันซ้ำ เปิดหีบซ้ำไม่สร้างผลซ้ำ
- Concurrent chest opens ไม่ใช้ inventory ticket เดียวเกินจำนวน
- Settle รอบและ Wallet updates atomic
- RLS ป้องกันผู้เล่นอ่าน/เขียนข้อมูลที่ไม่ใช่ของตน
- Host ไม่สามารถแก้ chest result ที่สำเร็จแล้ว
- Pairing code ใช้ได้ครั้งเดียวและหมดอายุ

### End-to-end tests

- สองเครื่องเข้าห้องเดียวกันและเห็น phase ตรงกัน
- เล่นครบทั้ง 8 รอบและผ่าน Event checkpoints
- ซื้อหีบหลายใบจนทอง/เพชรเป็นศูนย์
- เปิดหีบแล้ว Wallet เพิ่มตรงกันบนทั้งสองเครื่อง
- Refresh/reconnect ใน briefing, question, event และ chest phases
- ขอแลก ปฏิเสธ/คืนยอด และอนุมัติ/ส่งมอบ

### Economy validation

จำลองอย่างน้อย 10,000 เกมด้วยอัตราความถูก 40%, 60%, 80% และ 100% ตรวจว่า:

- ผู้เล่นทั่วไป 60–80% ได้ประมาณ 1,800–2,400 ทองและ 1–3 เพชรก่อน Event
- หีบระดับสูงไม่กลายเป็นตัวเลือกที่คุ้มกว่าทุกกรณีโดยไร้ trade-off
- Maximum liability ไม่เกิน inventory ที่ Host เติม
- ทอง/เพชรเป็นศูนย์หลังยืนยันตะกร้าทุกเส้นทาง

## 21. การแยกจาก RingQuiz และ deployment

- Frontend เป็น Vite/React/TypeScript project ใหม่ มี URL และ build แยกจาก RingQuiz
- ใช้ `VITE_SUPABASE_URL` และ anon key ของ project เดียวกับ RingQuiz
- Migration และ Edge Functions ใหม่ใช้ namespace ของ Treasure Quiz เท่านั้น
- ห้ามแก้ enum/table/function เดิมของ RingQuiz เว้นแต่มี migration แยกและการทดสอบยืนยันว่าไม่กระทบ
- การ deploy ครั้งแรกเป็น environment สำหรับทดสอบแบบ private ก่อน จากนั้นจึงเปิด URL ให้ Contestant หลังตั้ง Prize inventory และ Reward catalog แล้ว

## 22. Definition of done สำหรับ MVP

MVP เสร็จเมื่อ Game Master และ Contestant ใช้โทรศัพท์คนละเครื่องเล่นเกมจริงครบ 8 รอบผ่าน URL เดียวกันได้, ระบบเดิมพันและ Event ทำงานตามกติกา, Contestant ซื้อและเปิดหีบหลายใบจนทอง/เพชรหมด, เงินรางวัลถูกบันทึกเป็นสตางค์และสะสมข้ามเกม, สามารถขอแลกรางวัลและให้ Host อนุมัติ/ส่งมอบได้ และการทดสอบ security/idempotency/economy ที่ระบุผ่านทั้งหมดโดยไม่เปลี่ยนข้อมูล RingQuiz เดิม
