/**
 * Maps backend error codes returned by host-action / other Edge Functions
 * to Thai operator-friendly messages for display in the Host panel.
 *
 * Backend codes remain stable — this mapping is frontend-only.
 * Unknown codes fall back gracefully; the raw code is logged to the console.
 */
const HOST_ERROR_MAP: Record<string, string> = {
  // State-machine / transition errors
  invalid_transition:        'ตอนนี้ยังทำขั้นตอนนี้ไม่ได้ กรุณาตรวจสอบสถานะเกมก่อน',
  already_in_state:          'เกมอยู่ในสถานะนี้แล้ว',

  // Question / game-set flow
  no_next_question:          'ไม่มีคำถามถัดไปแล้ว',
  no_current_question:       'ยังไม่มีคำถามที่กำลังเล่นอยู่',
  question_not_open:         'ยังไม่ได้เปิดคำถาม',
  question_already_closed:   'คำถามปิดไปแล้ว',
  no_active_game_set:        'ยังไม่ได้เลือกชุดคำถามสำหรับเกมนี้ กรุณาเปิดใช้ Game Set ก่อน',
  game_not_ready:            'เกมยังไม่พร้อม กรุณาตรวจสอบการตั้งค่าก่อนเริ่ม',

  // Auth
  unauthorized:              'คุณไม่มีสิทธิ์ควบคุมเกมนี้',
  wrong_secret:              'รหัสโฮสต์ไม่ถูกต้อง',
  missing_host_secret:       'ไม่พบรหัสโฮสต์ กรุณาใส่รหัสอีกครั้ง',
  server_missing_host_secret:'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า HOST_SECRET กรุณาติดต่อผู้ดูแลระบบ',

  // Network / server
  network_error:             'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  function_error:            'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง',
  internal:                  'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์',
  realtime_error:            'การเชื่อมต่อแบบเรียลไทม์มีปัญหา กรุณารีเฟรชหน้าจอ',

  // Misc
  unknown_action:            'คำสั่งนี้ยังไม่รองรับโดยเวอร์ชันที่ Deploy อยู่',
  invalid_json:              'คำสั่งไม่ถูกต้อง',
  missing_action:            'ไม่ระบุคำสั่ง',
};

/**
 * Returns a Thai operator-friendly message for a given backend error code.
 * Falls back to a generic Thai message for unknown codes.
 *
 * @param code  - raw error string from Edge Function response
 * @param raw   - optional raw detail / HTTP status for console logging
 */
export function getHostActionMessage(code: string, raw?: string): string {
  const mapped = HOST_ERROR_MAP[code];
  if (!mapped) {
    console.warn('[host-action] unmapped error code:', code, raw ?? '');
    return `เกิดข้อผิดพลาด (${code}) กรุณาลองใหม่อีกครั้ง`;
  }
  return mapped;
}
