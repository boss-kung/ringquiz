import { useState, useCallback, useRef } from 'react';
import { supabase, FUNCTIONS_URL } from '../lib/supabase';
import { useGameStore } from '../store/gameStore';
import type { SubmitAnswerRequest, SubmitAnswerResponse, EdgeFunctionError } from '../lib/types';
import { triggerFeedbackFx, unlockFeedbackAudio } from '../lib/feedbackFx';


/**
 * Calls the submit-answer Edge Function.
 * Frontend never computes correctness or score — those come from the server.
 */
export function useAnswerSubmit() {
  const question = useGameStore((s) => s.question);
  const circlePosition = useGameStore((s) => s.circlePosition);
  const setCirclePosition = useGameStore((s) => s.setCirclePosition);
  const setSubmitPending = useGameStore((s) => s.setSubmitPending);
  const setSubmitResult = useGameStore((s) => s.setSubmitResult);
  const setSubmitError = useGameStore((s) => s.setSubmitError);
  const clearPendingSubmission = useGameStore((s) => s.clearPendingSubmission);
  const submitted = useGameStore((s) => s.submitted);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const submit = useCallback(async (positionOverride?: { xRatio: number; yRatio: number }) => {
    const positionToSubmit = positionOverride ?? circlePosition;
    if (!question || !positionToSubmit || submitted || submitting || submitLockRef.current) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitPending();

    try {
      await unlockFeedbackAudio();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        clearPendingSubmission();
        setSubmitError('ยังไม่ได้ล็อกอิน — โปรด refresh และเข้าร่วมใหม่');
        return;
      }

      const body: SubmitAnswerRequest = {
        question_id: question.id,
        x_ratio: positionToSubmit.xRatio,
        y_ratio: positionToSubmit.yRatio,
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
        clearPendingSubmission();
        switch (err.error) {
          case 'question_not_open':
            setSubmitError('คำถามปิดแล้ว — คำตอบไม่ได้รับการบันทึก');
            break;
          case 'time_expired':
            setSubmitError('หมดเวลา! คำตอบไม่ได้รับการบันทึก');
            break;
          case 'wrong_question':
            setSubmitError('เกมข้ามไปข้อถัดไปแล้ว — คำตอบไม่ได้รับการบันทึก');
            break;
          case 'player_not_found':
            setSubmitError('ไม่พบข้อมูลผู้เล่น — โปรด refresh และเข้าร่วมใหม่');
            break;
          case 'unauthorized':
            setSubmitError('Session หมดอายุ — โปรด refresh และเข้าร่วมใหม่');
            break;
          default:
            setSubmitError('ส่งคำตอบไม่สำเร็จ — โปรดลองอีกครั้ง');
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
      triggerFeedbackFx('answerLocked');
    } catch {
      clearPendingSubmission();
      setSubmitError('เกิดข้อผิดพลาดเครือข่าย — ตรวจสอบสัญญาณและลองใหม่');
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [question, circlePosition, submitted, submitting, setCirclePosition, setSubmitPending, setSubmitResult, setSubmitError, clearPendingSubmission]);

  return { submit, submitting };
}
