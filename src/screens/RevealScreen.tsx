import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useRevealResult } from '../hooks/useRevealResult';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { FUNCTIONS_URL } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';
import { triggerFeedbackFx } from '../lib/feedbackFx';

// ── Streak helpers (localStorage, local-only, never written to Supabase) ─────

function getStreakKey(playerId: string, sessionVersion: number | string) {
  return `playerVisualStreak:${sessionVersion}:${playerId}`;
}

function loadStreak(key: string): number {
  try {
    return parseInt(window.localStorage.getItem(key) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveStreak(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // storage may be blocked — streak is visual-only, ignore
  }
}

function streakLabel(n: number): string {
  if (n >= 5) return `🔥 On fire x${n}`;
  if (n >= 3) return `🌶 Hot streak x${n}`;
  return `⚡ Streak x${n}`;
}

export function RevealScreen() {
  useRevealResult();

  const question = useGameStore((s) => s.question);
  const revealResult = useGameStore((s) => s.revealResult);
  const revealNoAnswer = useGameStore((s) => s.revealNoAnswer);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const submitResult = useGameStore((s) => s.submitResult);
  const gameState = useGameStore((s) => s.gameState);
  const playerId = useGameStore((s) => s.playerId);
  const getServerTime = useGetServerTime();
  const [showRevealImage, setShowRevealImage] = useState(false);
  const [revealImageReady, setRevealImageReady] = useState(false);
  const revealStartedAt = gameState?.updated_at ?? null;
  const feedbackFiredRef = useRef(false);
  const streakUpdatedRef = useRef<string | null>(null); // keyed by question.id + result

  // Local-only visual streak
  const [visualStreak, setVisualStreak] = useState(0);

  useEffect(() => {
    if (!question || !revealStartedAt) {
      setShowRevealImage(false);
      return;
    }
    const revealImageAtMs = new Date(revealStartedAt).getTime() + 5000;
    const syncRevealPhase = () => setShowRevealImage(getServerTime() >= revealImageAtMs);
    syncRevealPhase();
    const id = setInterval(syncRevealPhase, 200);
    return () => clearInterval(id);
  }, [revealStartedAt, getServerTime, question?.id]);

  const effectiveRevealResult = revealResult ?? (
    submitResult
      ? {
          is_correct: submitResult.is_correct,
          score: submitResult.score,
          selected_x_ratio: submitResult.selected_x_ratio ?? circlePosition?.xRatio ?? null,
          selected_y_ratio: submitResult.selected_y_ratio ?? circlePosition?.yRatio ?? null,
        }
      : null
  );

  // Feedback FX
  useEffect(() => {
    if (!effectiveRevealResult) {
      feedbackFiredRef.current = false;
      return;
    }
    if (feedbackFiredRef.current) return;
    feedbackFiredRef.current = true;
    triggerFeedbackFx(effectiveRevealResult.is_correct ? 'answerCorrect' : 'answerWrong');
  }, [effectiveRevealResult?.is_correct, effectiveRevealResult?.score]);

  // Visual streak — update once per question result
  useEffect(() => {
    if (!effectiveRevealResult || !playerId || !question) return;
    const resultKey = `${question.id}:${effectiveRevealResult.is_correct}`;
    if (streakUpdatedRef.current === resultKey) return;
    streakUpdatedRef.current = resultKey;

    const sessionVersion = gameState?.session_version ?? 0;
    const key = getStreakKey(playerId, sessionVersion);
    const current = loadStreak(key);

    if (effectiveRevealResult.is_correct) {
      const next = current + 1;
      saveStreak(key, next);
      setVisualStreak(next);
    } else {
      saveStreak(key, 0);
      setVisualStreak(0);
    }
  }, [effectiveRevealResult, playerId, question?.id, gameState?.session_version]);

  // Also reset streak on no-answer
  useEffect(() => {
    if (!revealNoAnswer || !playerId) return;
    if (!question) return;
    const resultKey = `${question.id}:no-answer`;
    if (streakUpdatedRef.current === resultKey) return;
    streakUpdatedRef.current = resultKey;

    const sessionVersion = gameState?.session_version ?? 0;
    const key = getStreakKey(playerId, sessionVersion);
    saveStreak(key, 0);
    setVisualStreak(0);
  }, [revealNoAnswer, playerId, question?.id, gameState?.session_version]);

  const originalQuestionImage = question
    ? resolveQuestionImageUrl(question.image_url)
    : null;
  const revealBaseImage = question
    ? (resolveRevealImageUrl(question.reveal_image_url) ?? originalQuestionImage)
    : null;

  useEffect(() => {
    if (!revealBaseImage || revealBaseImage === originalQuestionImage) {
      setRevealImageReady(true);
      return;
    }

    setRevealImageReady(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.onerror = () => {
      if (!cancelled) setRevealImageReady(true);
    };
    img.src = revealBaseImage;

    return () => {
      cancelled = true;
    };
  }, [originalQuestionImage, revealBaseImage]);

  if (!question) {
    return (
      <div style={{ display: 'flex', minHeight: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
        <p style={{ color: 'var(--text-2)' }}>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  const isCorrect = effectiveRevealResult?.is_correct ?? false;
  const revealCircle =
    effectiveRevealResult?.selected_x_ratio != null && effectiveRevealResult?.selected_y_ratio != null
      ? { xRatio: effectiveRevealResult.selected_x_ratio, yRatio: effectiveRevealResult.selected_y_ratio }
      : null;
  const persistentCircle = circlePosition ?? revealCircle;
  const isResolvingResult = !effectiveRevealResult && !revealNoAnswer;

  /* Banner variant */
  let bannerClass = 'gr-reveal-banner gr-reveal-banner-neutral';
  let resultIcon = '—';
  let resultLabel = 'กำลังดึงผลลัพธ์...';
  let resultSub: string | null = null;

  if (revealNoAnswer) {
    bannerClass = 'gr-reveal-banner gr-reveal-banner-neutral';
    resultIcon = '—';
    resultLabel = 'ไม่ได้ตอบ';
    resultSub = 'คุณไม่ได้ส่งคำตอบสำหรับคำถามนี้';
  } else if (effectiveRevealResult) {
    if (isCorrect) {
      bannerClass = 'gr-reveal-banner gr-reveal-banner-ok';
      resultIcon = '🎯';
      resultLabel = 'ถูกต้อง!';
      resultSub = `+${effectiveRevealResult.score.toLocaleString()} คะแนน`;
    } else {
      bannerClass = 'gr-reveal-banner gr-reveal-banner-bad';
      resultIcon = '✗';
      resultLabel = 'ไม่ถูกต้อง';
      resultSub = 'ไว้ลองใหม่ในข้อหน้า';
    }
  }

  // Root screen state class
  let screenStateClass = 'is-resolving';
  if (revealNoAnswer) screenStateClass = 'is-no-answer';
  else if (effectiveRevealResult) screenStateClass = isCorrect ? 'is-correct' : 'is-wrong';

  const showScoreFloat = isCorrect && effectiveRevealResult && effectiveRevealResult.score > 0;
  const showStreak = visualStreak >= 2 && isCorrect;

  return (
    <div
      className={`gr-reveal-screen ${screenStateClass}`}
      style={{ display: 'flex', minHeight: '100%', flexDirection: 'column', background: 'var(--navy)', position: 'relative' }}
    >
      {/* Background glows */}
      <div className="gr-glow gr-glow-a" style={{ opacity: .6 }} />
      <div className="gr-glow gr-glow-b" style={{ opacity: .6 }} />

      {/* Result banner */}
      <div className={bannerClass} style={{ position: 'relative', zIndex: 1 }}>
        {isResolvingResult ? (
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>กำลังดึงผลลัพธ์...</p>
        ) : (
          <>
            <div style={{ fontSize: 26, marginBottom: 6 }}>{resultIcon}</div>
            <div
              style={{
                fontSize: 19, fontWeight: 900,
                color: revealNoAnswer ? 'var(--text-2)' : isCorrect ? 'var(--emerald)' : 'var(--rose)',
              }}
            >
              {resultLabel}
            </div>
            {resultSub && (
              <div
                className="gr-mono"
                style={{
                  fontSize: effectiveRevealResult && isCorrect ? 18 : 11,
                  fontWeight: 900,
                  color: effectiveRevealResult && isCorrect ? 'var(--gold)' : 'var(--text-2)',
                  marginTop: 4,
                }}
              >
                {resultSub}
              </div>
            )}

            {/* Floating score */}
            {showScoreFloat && (
              <div className="gr-score-float" aria-hidden>
                +{effectiveRevealResult!.score.toLocaleString()}
              </div>
            )}

            {/* Streak pill */}
            {showStreak && (
              <div
                className={`gr-streak-pill${visualStreak >= 5 ? ' gr-streak-pill-fire' : visualStreak >= 3 ? ' gr-streak-pill-hot' : ''}`}
                aria-label={`Streak ${visualStreak}`}
              >
                {streakLabel(visualStreak)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Image area */}
      <div style={{ flex: 1, minHeight: 0, padding: '8px 16px', position: 'relative', zIndex: 1 }}>
        <div className="quiz-image-stage">
          <QuestionImage
            imageUrl={showRevealImage && revealImageReady ? revealBaseImage : originalQuestionImage}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={persistentCircle}
            onCircleChange={() => {}}
            locked
            maskOverlayClassName="reveal-mask-pulse"
            maskOverlayUrl={`${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(
              question.id
            )}&updatedAt=${encodeURIComponent(gameState?.updated_at ?? '')}`}
            shellClassName={`quiz-image-shell--reveal${showRevealImage && revealImageReady ? ' quiz-image-shell--reveal-active' : ''}`}
          />
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          background: 'rgba(8,13,28,.75)',
          padding: '8px 18px calc(16px + env(safe-area-inset-bottom, 0px))',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <p className="gr-label-xs">กำลังรอตารางคะแนน…</p>
      </div>
    </div>
  );
}
