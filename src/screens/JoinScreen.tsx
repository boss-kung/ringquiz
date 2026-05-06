import { useState, useEffect } from 'react';
import { usePlayerSession } from '../hooks/usePlayerSession';
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from '../lib/constants';
import { unlockFeedbackAudio } from '../lib/feedbackFx';

function RingMark({ size = 96 }: { size?: number }) {
  const r1 = size * 0.45, r2 = size * 0.38, r3 = size * 0.31;
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={cx} cy={cy} r={r1} fill="none" stroke="rgba(245,199,74,.12)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r2} fill="none" stroke="rgba(245,199,74,.22)" strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={r3} fill="none" stroke="rgba(245,199,74,.35)" strokeWidth="1.5" />
      <circle cx={cx} cy={cy - r1 + 1} r="2.5" fill="rgba(245,199,74,.85)" />
      <circle cx={cx + r1 - 1} cy={cy} r="2" fill="rgba(245,199,74,.55)" />
      <circle cx={cx} cy={cy + r1 - 1} r="2" fill="rgba(245,199,74,.55)" />
      <circle cx={cx - r1 + 1} cy={cy} r="2" fill="rgba(245,199,74,.4)" />
    </svg>
  );
}

export function JoinScreen() {
  const { join, loading, error, savedName } = usePlayerSession();
  const [name, setName] = useState(savedName);
  const inputId = 'join-display-name';

  useEffect(() => { setName(savedName); }, [savedName]);

  const canSubmit = name.trim().length >= DISPLAY_NAME_MIN_LENGTH && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await unlockFeedbackAudio();
    join(name.trim());
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100%',
        padding: '44px 28px 28px',
        background: 'var(--navy)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />
      <div className="gr-glow gr-glow-c" />

      {/* Animated rotating rings */}
      <div className="gr-join-ring-1" />
      <div className="gr-join-ring-2" />
      <div className="gr-join-ring-3" />
      <div className="gr-join-glow" />

      {/* Orbiting dots */}
      <div className="gr-orbit-dot gr-orbit-dot-1" />
      <div className="gr-orbit-dot gr-orbit-dot-2" />
      <div className="gr-orbit-dot gr-orbit-dot-3" />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 340 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RingMark size={96} />
            <div
              className="gr-join-logo"
              style={{
                position: 'absolute',
                width: 44, height: 44,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,rgba(245,199,74,.14),rgba(245,199,74,.04))',
                border: '1.5px solid rgba(245,199,74,.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}
            >
              ♦
            </div>
          </div>
          <div className="gr-label-sm gr-gold gr-join-title" style={{ marginBottom: 10, letterSpacing: '.18em', fontSize: 20, fontWeight: 700 }}>
            Golden Ring
          </div>
          <h1 className="gr-join-title" style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.15, letterSpacing: '-.02em', color: 'var(--text)' }}>
            เกมวงแหวนปริศนา
          </h1>
          <p className="gr-join-subtitle" style={{ marginTop: 10, fontSize: 18, color: 'var(--text-2)', lineHeight: 1.55 }}>
            ใส่ชื่อของคุณเพื่อเข้าสู่เกม<br/>แข่งขันกับผู้เล่นคนอื่นๆ ในการแก้ปริศนาวงแหวนที่ท้าทายที่สุด!
          </p>
        </div>

        <form onSubmit={handleSubmit} className="gr-join-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor={inputId} className="gr-label-xs" style={{ color: 'var(--text-2)',fontSize: 16 }}>
            กรอกชื่อเล่นของคุณ
          </label>
          <input
            id={inputId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="เช่น อลิซาเบธ, บ็อบ, ชาร์ลี"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoFocus
            className="gr-input"
          />

          {error && (
            <p style={{ color: 'var(--rose)', fontSize: 16, textAlign: 'center' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="gr-btn gr-btn-gold"
          >
            {loading ? 'กำลังเข้าร่วม…' : 'เข้าสู่เกม →'}
          </button>
        </form>
      </div>
    </div>
  );
}
