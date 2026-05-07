import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { COUNTDOWN_DISPLAY_SECONDS } from '../lib/constants';
import { useGetServerTime } from '../hooks/useServerTime';
import { useImagePreloadStatus, usePrimeImages } from '../hooks/useImagePreload';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { getSpecialRulePresentation, hasSpecialRule } from '../lib/specialRules';

export function CountdownScreen() {
  const question = useGameStore((s) => s.question);
  const gameState = useGameStore((s) => s.gameState);
  const getServerTime = useGetServerTime();

  const totalCountdownMs = COUNTDOWN_DISPLAY_SECONDS * 1000;
  const [remainingMs, setRemainingMs] = useState(totalCountdownMs);
  const [count, setCount] = useState(COUNTDOWN_DISPLAY_SECONDS);
  const [showClue, setShowClue] = useState(false);

  const progress = Math.max(0, Math.min(1, (totalCountdownMs - remainingMs) / totalCountdownMs));
  const ringCircumference = 2 * Math.PI * 70;
  const ringOffset = progress >= 1 ? 0 : ringCircumference * (1 - progress);
  const countdownStartedAt = gameState?.updated_at ?? null;
  const cluePhase = showClue;
  const displayOrder = question?.play_order ?? question?.order_index ?? gameState?.current_question_index ?? null;

  useEffect(() => {
    setShowClue(false);
    if (!countdownStartedAt) return;

    const startMs = new Date(countdownStartedAt).getTime();
    const elapsedMs = Math.max(0, getServerTime() - startMs);
    const initialRemainingMs = Math.max(0, totalCountdownMs - elapsedMs);
    setRemainingMs(initialRemainingMs);
    setCount(initialRemainingMs > 0 ? Math.ceil(initialRemainingMs / 1000) : 0);

    if (initialRemainingMs <= 0) {
      const clueTimerId = setTimeout(() => setShowClue(true), 350);
      return () => clearTimeout(clueTimerId);
    }

    const visualStartedAt = performance.now() - elapsedMs;
    let animationFrameId = 0;
    let clueTimerId: ReturnType<typeof setTimeout> | null = null;

    const syncCountdown = () => {
      const elapsedMs = performance.now() - visualStartedAt;
      const nextRemainingMs = Math.max(0, totalCountdownMs - elapsedMs);

      if (nextRemainingMs <= 0) {
        setRemainingMs(0);
        setCount(0);
        if (!clueTimerId) {
          clueTimerId = setTimeout(() => setShowClue(true), 350);
        }
        return;
      }

      setRemainingMs(nextRemainingMs);
      setCount(Math.ceil(nextRemainingMs / 1000));
      animationFrameId = requestAnimationFrame(syncCountdown);
    };

    animationFrameId = requestAnimationFrame(syncCountdown);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (clueTimerId) clearTimeout(clueTimerId);
    };
  }, [countdownStartedAt, question?.id, totalCountdownMs, getServerTime]);

  const clueImageUrl = useMemo(() => {
    return question ? resolveQuestionImageUrl(question.image_url) : null;
  }, [question]);
  const revealImageUrl = useMemo(() => {
    return question ? resolveRevealImageUrl(question.reveal_image_url) : null;
  }, [question]);
  usePrimeImages([clueImageUrl, revealImageUrl], 6500);
  const clueImageStatus = useImagePreloadStatus(clueImageUrl, 6500);
  const specialRulePresentation = question
    ? getSpecialRulePresentation(
        question.special_rule_type ?? 'normal',
        question.special_rule_config ?? {},
        cluePhase ? 'clue' : 'countdown',
      )
    : null;
  const showSpecialRule = hasSpecialRule(question?.special_rule_type);

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
        padding: cluePhase ? '8px 12px' : '36px 20px 20px',
        textAlign: 'center',
      }}
    >
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" />
      <div className="gr-glow gr-glow-b" />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: showSpecialRule || cluePhase ? 480 : 320 }}>
        {displayOrder !== null && (
          <div className="gr-label-sm gr-gold" style={{ marginBottom: 10, letterSpacing: '.18em', fontSize: 24 }}>
            Question {displayOrder ?? '—'}
          </div>
        )}

        {specialRulePresentation && (
          <div
            className={`gr-special-round-card special-rule-card special-rule-card--${specialRulePresentation.theme}`}
            style={{ marginBottom: 12 }}
          >
            <div className="gr-special-round-card-badge special-rule-badge">SPECIAL RULE</div>
            <div className="gr-special-round-card-title">{specialRulePresentation.label}</div>
            <div className="gr-special-round-card-copy">{specialRulePresentation.bigScreenMessage}</div>
          </div>
        )}

        <div className="gr-card" style={{ padding: cluePhase ? '18px 12px' : '28px 20px' }}>
          {!cluePhase ? (
            <>
              <p style={{ fontSize: 18, color: 'var(--text-2)', marginBottom: 22 }}>เตรียมพร้อม!</p>

              {/* Countdown ring */}
              <div style={{ position: 'relative', width: 160, height: 160, margin: '0 auto' }}>
                {/* Outer decorative rings */}
                <svg
                  style={{ position: 'absolute', inset: -14, width: 188, height: 188 }}
                  viewBox="0 0 188 188"
                  aria-hidden
                >
                  <circle cx="94" cy="94" r="88" fill="none" stroke="rgba(245,199,74,.06)" strokeWidth="1" />
                  <circle cx="94" cy="94" r="80" fill="none" stroke="rgba(245,199,74,.11)" strokeWidth="1" />
                </svg>

                {/* Progress ring */}
                <svg
                  className="countdown-ring"
                  style={{ position: 'absolute', inset: 0, width: 160, height: 160 }}
                  viewBox="0 0 160 160"
                  aria-hidden
                >
                  <defs>
                    <linearGradient id="grRingGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#C49A1A" />
                      <stop offset="100%" stopColor="#F5C74A" />
                    </linearGradient>
                  </defs>
                  <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="9" />
                  <circle
                    cx="80" cy="80" r="70"
                    fill="none"
                    stroke="url(#grRingGrad)"
                    strokeWidth="9"
                    strokeLinecap="round"
                    transform="rotate(-90 80 80)"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    style={{ transition: 'none' }}
                  />
                </svg>

                {/* Center */}
                <div
                  style={{
                    position: 'absolute', inset: 12,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(16,24,48,.97), rgba(8,13,28,1))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'inset 0 0 28px rgba(0,0,0,.5)',
                  }}
                >
                  <div key={count} className="gr-countdown-num">
                    {count > 0 ? count : '●'}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {clueImageUrl && clueImageStatus === 'loaded' ? (
                <div className="quiz-image-shell quiz-image-shell--clue">
                  <div className="quiz-image-circle">
                    <img
                      src={clueImageUrl}
                      alt="Clue"
                      className="quiz-image-media"
                      draggable={false}
                    />
                  </div>
                </div>
              ) : clueImageUrl && clueImageStatus === 'loading' ? (
                <div className="gr-image-loading-card">
                  <div className="gr-image-loading-spinner" aria-hidden />
                  <div>กำลังเตรียมภาพปริศนา...</div>
                </div>
              ) : clueImageUrl && clueImageStatus === 'error' ? (
                <div className="gr-image-loading-card">
                  <div>โหลดภาพไม่สำเร็จ</div>
                  <div className="gr-image-loading-subtle">คำถามจะยังดำเนินต่อได้ตามปกติ</div>
                </div>
              ) : (
                <div className="gr-card" style={{ padding: '16px 18px', color: 'var(--text-2)', fontSize: 18 }}>
                  ไม่มีภาพปริศนาสำหรับคำถามนี้
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
