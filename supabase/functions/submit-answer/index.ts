// submit-answer — validates and scores a player's answer.
// Auth: player JWT (Supabase anonymous auth session token).
//
// Security contract:
//   - Correctness computed server-side from mask image. Never trusted from client.
//   - Score computed from server time. Never from client-provided timestamps.
//   - Scoring uses game_set_questions snapshot values when current_game_set_question_id
//     is set; falls back to questions table values for backward compatibility.
//   - mask_storage_path is never included in any response.
//   - Duplicate submissions return the existing result (idempotent).
//   - Late submissions (NOW() > question_ends_at) are rejected with 400.
//   - Wrong-state submissions (status !== question_open) are rejected with 400.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import { checkCircleOverlapsMask, getCachedMask } from './mask-check.ts';
import type {
  GameState,
  QuestionMask,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  ErrorResponse,
} from '../_shared/types.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  // 1. Authenticate player via JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return err(401, 'unauthorized');
  const token = authHeader.replace('Bearer ', '');

  const db = getSupabaseAdmin();
  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return err(401, 'unauthorized');

  // 2. Parse and validate body
  let body: SubmitAnswerRequest;
  try {
    body = await req.json();
  } catch {
    return err(400, 'invalid_json');
  }

  if (!body?.question_id) return err(400, 'missing_field', 'question_id');
  if (body.x_ratio == null || body.x_ratio < 0 || body.x_ratio > 1)
    return err(400, 'invalid_ratio', 'x_ratio');
  if (body.y_ratio == null || body.y_ratio < 0 || body.y_ratio > 1)
    return err(400, 'invalid_ratio', 'y_ratio');

  const { question_id, x_ratio, y_ratio } = body;

  try {
    // 3. Validate game state
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id, question_started_at, question_ends_at, current_game_set_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'status' | 'current_question_id' | 'question_started_at' | 'question_ends_at' | 'current_game_set_question_id'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    if (gs.status !== 'question_open') return err(400, 'question_not_open');
    if (gs.current_question_id !== question_id) return err(400, 'wrong_question');

    // 4. Server-time deadline check (2-second grace window for network latency)
    const serverNow = new Date();
    const endsAt = gs.question_ends_at ? new Date(gs.question_ends_at) : null;
    if (!endsAt) throw new Error('question_ends_at is null during question_open');
    const GRACE_MS = 2_000;
    if (serverNow.getTime() > endsAt.getTime() + GRACE_MS) return err(400, 'time_expired');

    // 5. Idempotency: check for existing submission before expensive mask work
    const { data: existing } = await db
      .from('answers')
      .select('is_correct, score, selected_x_ratio, selected_y_ratio')
      .eq('player_id', user.id)
      .eq('question_id', question_id)
      .maybeSingle();

    if (existing) {
      const body: SubmitAnswerResponse = {
        is_correct: existing.is_correct,
        score: existing.score,
        already_submitted: true,
        selected_x_ratio: existing.selected_x_ratio,
        selected_y_ratio: existing.selected_y_ratio,
      };
      return Response.json(body, { headers: corsHeaders });
    }

    // 6. Verify player row exists
    const { data: player } = await db
      .from('players')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (!player) return err(404, 'player_not_found');

    // 7. Fetch runtime scoring config:
    //    - If current_game_set_question_id is set, use game_set_questions snapshot values.
    //    - Otherwise fall back to questions table (legacy / pre-migration).
    let circleRadiusRatio: number;
    let maxScore: number;
    let minCorrectScore: number;

    if (gs.current_game_set_question_id) {
      const { data: gsq, error: gqErr } = await db
        .from('game_set_questions')
        .select('circle_radius_ratio, max_score, min_correct_score')
        .eq('id', gs.current_game_set_question_id)
        .single<{ circle_radius_ratio: number; max_score: number; min_correct_score: number }>();

      if (gqErr || !gsq) throw new Error('Failed to fetch game_set_question scoring config');

      circleRadiusRatio = gsq.circle_radius_ratio;
      maxScore = gsq.max_score;
      minCorrectScore = gsq.min_correct_score;
    } else {
      // Legacy fallback: read from questions table
      const { data: question, error: qErr } = await db
        .from('questions')
        .select('circle_radius_ratio, max_score, min_correct_score')
        .eq('id', question_id)
        .single<{ circle_radius_ratio: number; max_score: number; min_correct_score: number }>();

      if (qErr || !question) throw new Error('Failed to fetch question scoring config');

      circleRadiusRatio = question.circle_radius_ratio;
      maxScore = question.max_score;
      minCorrectScore = question.min_correct_score;
    }

    // 8. Fetch mask path + dimensions (service role bypasses RLS deny policy)
    const { data: maskRow, error: maskErr } = await db
      .from('question_masks')
      .select('mask_storage_path, mask_width, mask_height')
      .eq('question_id', question_id)
      .single<Pick<QuestionMask, 'mask_storage_path' | 'mask_width' | 'mask_height'>>();

    if (maskErr || !maskRow) throw new Error(`Mask not found for question ${question_id}`);

    // 9. Download mask PNG from private bucket (cache by path)
    const cacheKey = maskRow.mask_storage_path;
    let maskBuffer: ArrayBuffer;

    if (getCachedMask(cacheKey)) {
      maskBuffer = new ArrayBuffer(0);
    } else {
      const { data: maskFile, error: downloadErr } = await db.storage
        .from('question-masks')
        .download(maskRow.mask_storage_path);

      if (downloadErr || !maskFile) {
        throw new Error(`Mask download failed: ${downloadErr?.message}`);
      }
      maskBuffer = await maskFile.arrayBuffer();
    }

    // 10. Pixel overlap check using game-set circle radius
    const isCorrect = await checkCircleOverlapsMask(
      maskBuffer,
      x_ratio,
      y_ratio,
      circleRadiusRatio,
      cacheKey,
      maskRow.mask_width ?? undefined,
      maskRow.mask_height ?? undefined,
    );

    // 11. Compute score from server time
    const startedAt = gs.question_started_at ? new Date(gs.question_started_at) : serverNow;
    const totalMs = endsAt.getTime() - startedAt.getTime();
    const remainingMs = endsAt.getTime() - serverNow.getTime();
    const timeRemainingRatio = Math.max(0, Math.min(1, remainingMs / totalMs));

    const score = isCorrect
      ? Math.round(
          minCorrectScore +
          (maxScore - minCorrectScore) * timeRemainingRatio,
        )
      : 0;

    // 12. Insert answer (service role bypasses RLS)
    const { error: insertErr } = await db.from('answers').insert({
      player_id: user.id,
      question_id,
      selected_x_ratio: x_ratio,
      selected_y_ratio: y_ratio,
      submitted_at: serverNow.toISOString(),
      time_remaining_ratio: timeRemainingRatio,
      is_correct: isCorrect,
      score,
    });

    // Race condition: simultaneous request won the UNIQUE constraint
    if (insertErr?.code === '23505') {
      const { data: raceResult } = await db
        .from('answers')
        .select('is_correct, score, selected_x_ratio, selected_y_ratio')
        .eq('player_id', user.id)
        .eq('question_id', question_id)
        .single();

      const body: SubmitAnswerResponse = {
        is_correct: raceResult!.is_correct,
        score: raceResult!.score,
        already_submitted: true,
        selected_x_ratio: raceResult!.selected_x_ratio,
        selected_y_ratio: raceResult!.selected_y_ratio,
      };
      return Response.json(body, { headers: corsHeaders });
    }

    if (insertErr) throw new Error(`Answer insert failed: ${insertErr.message}`);

    // 13. Increment the player's convenience running total.
    // Authoritative exports/leaderboards still come from answers.score.
    await incrementPlayerScore(db, user.id, score);

    // 14. Return result — never includes mask path or mask data
    const responseBody: SubmitAnswerResponse = {
      is_correct: isCorrect,
      score,
      already_submitted: false,
    };
    return Response.json(responseBody, { headers: corsHeaders });

  } catch (e) {
    console.error('[submit-answer]', e);
    return err(500, 'internal');
  }
});

function err(status: number, code: string, field?: string): Response {
  const body: ErrorResponse = { error: code, ...(field ? { field } : {}) };
  return Response.json(body, { status, headers: corsHeaders });
}

async function syncPlayerTotalScore(
  db: ReturnType<typeof getSupabaseAdmin>,
  playerId: string,
): Promise<void> {
  const { data: answers, error: answersErr } = await db
    .from('answers')
    .select('score')
    .eq('player_id', playerId);

  if (answersErr) throw new Error(`Failed to read player answers: ${answersErr.message}`);

  const totalScore = (answers ?? []).reduce((sum, row) => sum + (row.score ?? 0), 0);
  const { error: updateErr } = await db
    .from('players')
    .update({ total_score: totalScore })
    .eq('id', playerId);

  if (updateErr) throw new Error(`Failed to sync player total score: ${updateErr.message}`);
}

async function incrementPlayerScore(
  db: ReturnType<typeof getSupabaseAdmin>,
  playerId: string,
  score: number,
): Promise<void> {
  if (!Number.isFinite(score) || score <= 0) return;

  const { error } = await db.rpc('increment_player_score', {
    p_player_id: playerId,
    p_amount: score,
  });

  if (!error) return;

  // Fallback only if the lightweight increment path fails unexpectedly.
  await syncPlayerTotalScore(db, playerId);
}
