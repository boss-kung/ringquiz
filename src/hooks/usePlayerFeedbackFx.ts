import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { triggerFeedbackFx } from '../lib/feedbackFx';

export function usePlayerFeedbackFx() {
  const gameState = useGameStore((s) => s.gameState);

  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const status = gameState?.status ?? null;
    const prevStatus = prevStatusRef.current;

    if (status && status !== prevStatus) {
      if (status === 'countdown') triggerFeedbackFx('countdownStart');
      if (status === 'question_open') triggerFeedbackFx('answerOpen');
      if (status === 'reveal') triggerFeedbackFx('reveal');
      if (status === 'leaderboard') triggerFeedbackFx('leaderboardShow');
    }

    prevStatusRef.current = status;
  }, [gameState?.status]);
}
