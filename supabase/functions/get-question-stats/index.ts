// get-question-stats — returns aggregate stats for the host dashboard.
// Auth: X-Host-Secret header.
//
// Game-set-aware (Phase 2+):
//   - total_questions counts enabled questions in the active game set.
//   - question_index returns the play_order of the current game-set question.
//   - Falls back to legacy questions.is_published / order_index if no game set.
//
// Safety: returns ONLY aggregate counts. Never raw answer rows, coordinates,
// individual scores, mask paths, or per-player data.
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

  const envSecret = Deno.env.get('HOST_SECRET')?.trim();
  if (!envSecret) {
    const body: ErrorResponse = { error: 'server_missing_host_secret' };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
  const providedSecret = req.headers.get('X-Host-Secret')?.trim();
  if (!providedSecret || providedSecret !== envSecret) {
    await sleep(300);
    const body: ErrorResponse = { error: 'unauthorized' };
    return Response.json(body, { status: 401, headers: corsHeaders });
  }

  const db = getSupabaseAdmin();

  try {
    // Fetch current game state (includes new game-set columns)
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id, current_question_index, question_ends_at, active_game_set_id, current_game_set_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'status' | 'current_question_id' | 'current_question_index' | 'question_ends_at' | 'active_game_set_id' | 'current_game_set_question_id'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    // Count submitted answers for the current question
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

    // Determine total questions and current position
    let totalQuestions = 0;
    let questionPosition: number | null = null;
    let activeGameSetName: string | null = null;

    if (gs.active_game_set_id) {
      // Game-set-aware: count enabled questions in the active game set
      const { count: gsqCount, error: gsqCountErr } = await db
        .from('game_set_questions')
        .select('id', { count: 'exact', head: true })
        .eq('game_set_id', gs.active_game_set_id)
        .eq('is_enabled', true);

      if (gsqCountErr) throw new Error(`GSQ count failed: ${gsqCountErr.message}`);
      totalQuestions = gsqCount ?? 0;

      // Current position = play_order of the current game-set question
      if (gs.current_game_set_question_id) {
        const { data: gsqRow } = await db
          .from('game_set_questions')
          .select('play_order')
          .eq('id', gs.current_game_set_question_id)
          .single<{ play_order: number }>();

        if (gsqRow) questionPosition = gsqRow.play_order;
      }

      // Fetch game set name for display
      const { data: gsRow } = await db
        .from('game_sets')
        .select('name')
        .eq('id', gs.active_game_set_id)
        .single<{ name: string }>();

      if (gsRow) activeGameSetName = gsRow.name;
    } else {
      // Legacy fallback: count published questions
      const { count: pubCount, error: pubCountErr } = await db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('is_published', true);

      if (pubCountErr) throw new Error(`Question count failed: ${pubCountErr.message}`);
      totalQuestions = pubCount ?? 0;

      // Position by order_index
      if (gs.current_question_index != null) {
        const { count: positionCount, error: positionErr } = await db
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('is_published', true)
          .lte('order_index', gs.current_question_index);

        if (positionErr) throw new Error(`Question position failed: ${positionErr.message}`);
        questionPosition = positionCount ?? null;
      }
    }

    const body: QuestionStatsResponse = {
      status: gs.status,
      question_id: gs.current_question_id,
      question_index: questionPosition,
      total_questions: totalQuestions,
      submitted_count: submittedCount,
      player_count: playerCount ?? 0,
      question_ends_at: gs.question_ends_at,
      active_game_set_id: gs.active_game_set_id,
      active_game_set_name: activeGameSetName,
    };
    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[get-question-stats]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
