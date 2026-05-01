// get-question-stats — returns aggregate stats for the host dashboard.
// Auth: X-Host-Secret header.
//
// Safety contract:
//   Returns ONLY aggregate counts and game state fields.
//   Never returns raw answer rows, coordinates, correctness per player,
//   individual scores, mask paths, or any player-level answer data.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type {
  GameState,
  QuestionStatsResponse,
  ErrorResponse,
} from '../_shared/types.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  // Auth: HOST_SECRET
  const providedSecret = req.headers.get('X-Host-Secret');
  if (!providedSecret || providedSecret !== Deno.env.get('HOST_SECRET')) {
    const body: ErrorResponse = { error: 'unauthorized' };
    return Response.json(body, { status: 401, headers: corsHeaders });
  }

  const db = getSupabaseAdmin();

  try {
    // Fetch current game state
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id, current_question_index, question_ends_at')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'status' | 'current_question_id' | 'current_question_index' | 'question_ends_at'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    // Count submitted answers for the current question
    // Returns only the count — no answer rows, no player data, no coordinates
    let submittedCount = 0;
    if (gs.current_question_id) {
      const { count, error: countErr } = await db
        .from('answers')
        .select('id', { count: 'exact', head: true })
        .eq('question_id', gs.current_question_id);

      if (countErr) throw new Error(`Count query failed: ${countErr.message}`);
      submittedCount = count ?? 0;
    }

    // Count total joined players
    const { count: playerCount, error: playerCountErr } = await db
      .from('players')
      .select('id', { count: 'exact', head: true });

    if (playerCountErr) throw new Error(`Player count failed: ${playerCountErr.message}`);

    // Count total published questions for host progress display
    const { count: totalQuestions, error: totalQuestionsErr } = await db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true);

    if (totalQuestionsErr) throw new Error(`Question count failed: ${totalQuestionsErr.message}`);

    let questionPosition = 0;
    if (gs.current_question_index != null) {
      const { count: positionCount, error: positionErr } = await db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('is_published', true)
        .lte('order_index', gs.current_question_index);

      if (positionErr) throw new Error(`Question position failed: ${positionErr.message}`);
      questionPosition = positionCount ?? 0;
    }

    const body: QuestionStatsResponse = {
      status: gs.status,
      question_id: gs.current_question_id,
      question_index: questionPosition || null,
      total_questions: totalQuestions ?? 0,
      submitted_count: submittedCount,
      player_count: playerCount ?? 0,
      question_ends_at: gs.question_ends_at,
    };
    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[get-question-stats]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
