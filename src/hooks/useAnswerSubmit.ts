import { useState, useCallback, useRef } from 'react';
import { supabase, FUNCTIONS_URL } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { SubmitAnswerRequest, SubmitAnswerResponse, EdgeFunctionError } from '../lib/types';


/**
 * Calls the submit-answer Edge Function.
 * Frontend never computes correctness or score — those come from the server.
 */
export function useAnswerSubmit() {
  const question = useGameStore((s) => s.question);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const setCirclePosition = useGameStore((s) => s.setCirclePosition);
  const setSubmitResult = useGameStore((s) => s.setSubmitResult);
  const setSubmitError = useGameStore((s) => s.setSubmitError);
  const submitted = useGameStore((s) => s.submitted);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const submit = useCallback(async () => {
    if (!question || !circlePosition || submitted || submitting || submitLockRef.current) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError('Not authenticated. Please refresh and rejoin.');
        return;
      }

      const body: SubmitAnswerRequest = {
        question_id: question.id,
        x_ratio: circlePosition.xRatio,
        y_ratio: circlePosition.yRatio,
      };

      const res = await fetch(`${FUNCTIONS_URL}/submit-answer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        const err = json as EdgeFunctionError;
        switch (err.error) {
          case 'question_not_open':
            setSubmitError('Question is no longer open. Your answer was not recorded.');
            break;
          case 'time_expired':
            setSubmitError('Time is up! Answer not recorded.');
            break;
          case 'wrong_question':
            setSubmitError('Game moved to the next question. Answer not recorded.');
            break;
          default:
            setSubmitError('Could not submit. Please try again.');
        }
        return;
      }

      const result = json as SubmitAnswerResponse;
      // Restore circle position if server returned existing coordinates
      if (result.already_submitted &&
          result.selected_x_ratio != null &&
          result.selected_y_ratio != null) {
        setCirclePosition({
          xRatio: result.selected_x_ratio,
          yRatio: result.selected_y_ratio,
        });
      }
      setSubmitResult(result);
    } catch {
      setSubmitError('Network error. Please check your connection and try again.');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [question, circlePosition, submitted, submitting, setCirclePosition, setSubmitResult, setSubmitError]);

  return { submit, submitting };
}
