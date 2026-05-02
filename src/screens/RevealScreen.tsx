import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useRevealResult } from '../hooks/useRevealResult';
import { useGetServerTime } from '../hooks/useServerTime';
import { QuestionImage } from '../components/QuestionImage';
import { FUNCTIONS_URL } from '../lib/supabase';
import { resolveQuestionImageUrl, resolveRevealImageUrl } from '../lib/questionAssets';

export function RevealScreen() {
  useRevealResult();

  const question = useGameStore((s) => s.question);
  const revealResult = useGameStore((s) => s.revealResult);
  const revealNoAnswer = useGameStore((s) => s.revealNoAnswer);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const gameState = useGameStore((s) => s.gameState);
  const getServerTime = useGetServerTime();
  const [showRevealImage, setShowRevealImage] = useState(false);

  if (!question) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-900">
        <p className="text-slate-400">กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  const bannerClass = revealResult
    ? revealResult.is_correct
      ? 'bg-emerald-700'
      : 'bg-rose-800'
    : 'bg-slate-700';

  const originalQuestionImage = resolveQuestionImageUrl(question.image_url);
  const revealBaseImage =
    resolveRevealImageUrl(question.reveal_image_url) ??
    resolveQuestionImageUrl(question.image_url);
  const revealStartedAt = gameState?.updated_at ?? null;

  useEffect(() => {
    if (!revealStartedAt) {
      setShowRevealImage(false);
      return;
    }

    const revealImageAtMs = new Date(revealStartedAt).getTime() + 5000;
    const syncRevealPhase = () => {
      setShowRevealImage(getServerTime() >= revealImageAtMs);
    };

    syncRevealPhase();
    const id = setInterval(syncRevealPhase, 200);
    return () => clearInterval(id);
  }, [revealStartedAt, getServerTime, question.id]);

  return (
    <div className="flex min-h-full flex-col bg-slate-900">
      <div className={`shrink-0 px-4 py-5 text-center ${bannerClass}`}>
        {!revealResult && !revealNoAnswer && (
          <p className="text-sm text-white/70">กำลังดึงผลลัพธ์...</p>
        )}

        {revealNoAnswer && (
          <>
            <div className="mb-1 text-4xl">—</div>
            <p className="text-xl font-bold text-white">ไม่ได้ตอบ</p>
            <p className="mt-1 text-sm text-white/60">
              คุณไม่ได้ส่งคำตอบสำหรับคำถามนี้
            </p>
          </>
        )}

        {revealResult && (
          <>
            <div className="mb-1 text-4xl">{revealResult.is_correct ? '🎯' : '❌'}</div>
            <p className="text-xl font-bold text-white">
              {revealResult.is_correct ? 'ถูกต้อง!' : 'ไม่ถูกต้อง'}
            </p>
            {revealResult.is_correct && (
              <p className="mt-1 text-sm text-white/80">
                +{revealResult.score.toLocaleString()} คะแนน
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 px-1 py-3 sm:px-4 sm:py-6">
        <div className="flex h-full items-center justify-center overflow-hidden">
          <QuestionImage
            imageUrl={showRevealImage ? revealBaseImage : originalQuestionImage}
            circleRadiusRatio={question.circle_radius_ratio}
            circle={
              revealResult
                ? {
                    xRatio: revealResult.selected_x_ratio,
                    yRatio: revealResult.selected_y_ratio,
                  }
                : circlePosition
            }
            onCircleChange={() => {}}
            locked
            maskOverlayClassName="reveal-mask-pulse"
            maskOverlayUrl={`${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(
              question.id
            )}&updatedAt=${encodeURIComponent(gameState?.updated_at ?? '')}`}
            shellClassName="quiz-image-shell--reveal"
          />
        </div>
      </div>

      <div className="shrink-0 bg-slate-800 px-4 py-4">
        <p className="text-center text-sm text-slate-400">
          กำลังรอประมวลผลตารางคะแนน...
        </p>
      </div>
    </div>
  );
}
