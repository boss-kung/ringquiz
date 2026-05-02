import { useGameStore } from '../store/gameStore';
import { useRevealResult } from '../hooks/useRevealResult';
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

  if (!question) {
    return (
      <div className="flex items-center justify-center min-h-full bg-slate-900">
        <p className="text-slate-400">Loading reveal…</p>
      </div>
    );
  }

  const bannerClass = revealResult
    ? revealResult.is_correct ? 'bg-emerald-700' : 'bg-rose-800'
    : revealNoAnswer ? 'bg-slate-700' : 'bg-slate-700';
  const revealBaseImage = resolveRevealImageUrl(question.reveal_image_url) ?? resolveQuestionImageUrl(question.image_url);

  return (
    <div className="flex flex-col min-h-full bg-slate-900">
      {/* Result banner */}
      <div className={`shrink-0 px-4 py-5 text-center ${bannerClass}`}>
        {!revealResult && !revealNoAnswer && (
          <p className="text-white/70 text-sm">Fetching your result…</p>
        )}
        {revealNoAnswer && (
          <>
            <div className="text-4xl mb-1">—</div>
            <p className="text-white text-xl font-bold">No answer submitted</p>
            <p className="text-white/60 text-sm mt-1">You didn't submit an answer for this question</p>
          </>
        )}
        {revealResult && (
          <>
            <div className="text-4xl mb-1">{revealResult.is_correct ? '🎯' : '❌'}</div>
            <p className="text-white text-xl font-bold">
              {revealResult.is_correct ? 'Correct!' : 'Not quite'}
            </p>
            {revealResult.is_correct && (
              <p className="text-white/80 text-sm mt-1">
                +{revealResult.score.toLocaleString()} points
              </p>
            )}
          </>
        )}
      </div>

      {/* Image with mask overlay — white area = correct zone */}
      <div className="flex-1 overflow-y-auto">
        <QuestionImage
          imageUrl={revealBaseImage}
          circleRadiusRatio={question.circle_radius_ratio}
          circle={
            revealResult
              ? { xRatio: revealResult.selected_x_ratio, yRatio: revealResult.selected_y_ratio }
              : circlePosition
          }
          onCircleChange={() => {}}
          locked
          maskOverlayClassName="reveal-mask-pulse"
          maskOverlayUrl={`${FUNCTIONS_URL}/get-reveal-mask?questionId=${encodeURIComponent(question.id)}&updatedAt=${encodeURIComponent(gameState?.updated_at ?? '')}`}
        />
      </div>

      <div className="shrink-0 px-4 py-4 bg-slate-800">
        <p className="text-center text-slate-400 text-sm">Waiting for the leaderboard…</p>
      </div>
    </div>
  );
}
