import { useState, useEffect, useRef } from 'react';
import { usePlayerSession } from '../hooks/usePlayerSession';
import { DISPLAY_NAME_MAX_LENGTH, DISPLAY_NAME_MIN_LENGTH } from '../lib/constants';
import { unlockFeedbackAudio } from '../lib/feedbackFx';
import { AVATAR_COLORS, AVATAR_COLOR_KEY, AVATAR_EMOJI_KEY, getAvatarGrad, getInitials, readStoredEmoji } from '../lib/avatarColor';

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
  const [colorIdx, setColorIdx] = useState<number>(() => {
    const stored = localStorage.getItem(AVATAR_COLOR_KEY);
    const parsed = stored !== null ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed < AVATAR_COLORS.length ? parsed : 0;
  });
  const [emoji, setEmoji] = useState<string>(() => readStoredEmoji());
  const [emojiInput, setEmojiInput] = useState('');
  const emojiInputRef = useRef<HTMLInputElement>(null);
  const inputId = 'join-display-name';

  useEffect(() => { setName(savedName); }, [savedName]);

  const handleColorSelect = (idx: number) => {
    setColorIdx(idx);
    localStorage.setItem(AVATAR_COLOR_KEY, String(idx));
  };

  const handleEmojiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const seg = new Intl.Segmenter();
    const [first] = [...seg.segment(val)];
    if (first?.segment.trim()) {
      const g = first.segment;
      setEmoji(g);
      localStorage.setItem(AVATAR_EMOJI_KEY, g);
    }
    setEmojiInput('');
    emojiInputRef.current?.blur();
  };

  const handleEmojiClear = () => {
    setEmoji('');
    localStorage.removeItem(AVATAR_EMOJI_KEY);
  };

  const canSubmit = name.trim().length >= DISPLAY_NAME_MIN_LENGTH && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await unlockFeedbackAudio();
    join(name.trim(), emoji || undefined);
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

          {/* Avatar preview + color picker + emoji */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            {/* Avatar circle */}
            <div
              style={{
                width: 60, height: 60, borderRadius: '50%',
                background: getAvatarGrad(colorIdx),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: emoji ? 28 : 18, fontWeight: 900, color: 'white',
                boxShadow: '0 0 18px rgba(0,0,0,.35)',
                transition: 'background .2s ease, font-size .15s',
                userSelect: 'none',
              }}
            >
              {emoji || getInitials(name) || '?'}
            </div>

            {/* Color swatches */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {AVATAR_COLORS.map((grad, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleColorSelect(idx)}
                  aria-label={`Avatar color ${idx + 1}`}
                  style={{
                    width: 26, height: 26, borderRadius: '50%',
                    background: grad,
                    border: colorIdx === idx ? '2px solid white' : '2px solid transparent',
                    outline: colorIdx === idx ? '2px solid rgba(245,199,74,.6)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'outline .15s, border .15s',
                    boxShadow: colorIdx === idx ? '0 0 8px rgba(245,199,74,.35)' : 'none',
                  }}
                />
              ))}
            </div>

            {/* Emoji picker row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center' }}>
              <div style={{ position: 'relative' }}>
                <input
                  ref={emojiInputRef}
                  type="text"
                  inputMode="text"
                  value={emojiInput}
                  onChange={handleEmojiChange}
                  placeholder={emoji ? emoji : '😊'}
                  aria-label="เลือก emoji"
                  style={{
                    width: 52, height: 44, borderRadius: 12, border: '1.5px solid rgba(255,255,255,.15)',
                    background: 'rgba(255,255,255,.06)', color: 'var(--text)',
                    fontSize: 24, textAlign: 'center', fontFamily: 'var(--font-sans)',
                    cursor: 'pointer', outline: 'none', caretColor: 'transparent',
                    transition: 'border-color .15s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(245,199,74,.5)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4, maxWidth: 160 }}>
                แตะช่องแล้วเปลี่ยน keyboard เป็น emoji
                {emoji && (
                  <button
                    type="button"
                    onClick={handleEmojiClear}
                    style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--rose)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0 }}
                  >
                    ลบ emoji
                  </button>
                )}
              </div>
            </div>
          </div>

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
