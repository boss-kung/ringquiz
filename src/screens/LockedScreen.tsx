import { useGameStore } from '../store/gameStore';

export function LockedScreen() {
  const submitResult = useGameStore((s) => s.submitResult);
  const submitPending = useGameStore((s) => s.submitPending);
  const question = useGameStore((s) => s.question);

  const hasAnswered = Boolean(submitResult || submitPending);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        minHeight: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        background: 'var(--navy)',
        padding: '44px 28px 28px',
        textAlign: 'center',
      }}
    >
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      {/* Concentric decorative rings */}
      {[190, 250, 310].map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: s, height: s,
            borderRadius: '50%',
            border: `1px solid rgba(245,199,74,${.09 - i * .025})`,
            top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            pointerEvents: 'none',
          }}
        />
      ))}

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 300 }}>
        {/* Floating lock ring */}
        <div className="gr-lock-ring" style={{ marginBottom: 26 }}>
          <div
            style={{
              width: 74, height: 74,
              borderRadius: '50%',
              background: 'radial-gradient(circle,rgba(245,199,74,.13),rgba(245,199,74,.03))',
              border: '1.5px solid rgba(245,199,74,.34)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30,
            }}
          >
            {hasAnswered ? '?' : '⏳'}
          </div>
        </div>

        <div className="gr-label-sm gr-gold" style={{ marginBottom: 9 , fontSize: 18 }}>
          {hasAnswered ? 'ส่งคำตอบแล้ว' : 'คุณตอบไม่ทันเวลา'}
        </div>

        <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 11, color: 'var(--text)' }}>
          {hasAnswered ? 'รอเฉลยคำตอบ…' : 'รอเฉลยคำตอบ…'}
        </h2>

        <p style={{ fontSize: 18, color: 'var(--text-2)', lineHeight: 1.6 }}>
          {hasAnswered
            ? submitPending
              ? 'รับคำตอบแล้ว — กำลังบันทึกคำตอบของคุณ...'
              : 'คำตอบถูกบันทึกแล้ว — รอดูว่าถูกหรือผิด!'
            : question
            ? 'การตอบคำถามข้อนี้จบแล้ว รอให้พิธีกรเฉลยคำตอบ'
            : 'กำลังรอพิธีกรเปิดคำถาม...'}
        </p>

        {hasAnswered && (
          <div className="gr-card-gold" style={{ marginTop: 20, padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 22 }}>🔒</div>
            <div style={{ textAlign: 'left' }}>
              <div className="gr-label-xs" style={{ marginBottom: 4 }}>สถานะคำตอบ</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>
                {submitPending ? 'รับคำตอบแล้ว · กำลังบันทึก' : 'ล็อคแล้ว · รอพิธีกรเฉลย'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
