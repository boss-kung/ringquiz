// get-question-stats — returns aggregate stats for the host dashboard.
// Auth: X-Host-Secret header.
//
// Game-set-aware (Phase 2+):
//   - total_questions counts enabled questions in the active game set.
//   - question_index returns the enabled-position of the current game-set question.
//   - Falls back to legacy questions.is_published / order_index if no game set.
//
// Safety: returns ONLY aggregate counts. Never raw answer rows, coordinates,
// individual scores, mask paths, or per-player data.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type {
  ErrorResponse,
  GameState,
  QuestionStatsResponse,
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
    // Fetch current game state (includes new game-set columns).
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id, current_question_index, question_ends_at, active_game_set_id, current_game_set_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<
        Pick<
          GameState,
          | 'status'
          | 'current_question_id'
          | 'current_question_index'
          | 'question_ends_at'
          | 'active_game_set_id'
          | 'current_game_set_question_id'
        >
      >();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    // Count submitted answers and total joined players in parallel.
    const [answersResult, playersResult] = await Promise.all([
      gs.current_question_id
        ? db.from('answers').select('id', { count: 'exact', head: true }).eq('question_id', gs.current_question_id)
        : Promise.resolve({ count: 0, error: null }),
      db.from('players').select('id', { count: 'exact', head: true }),
    ]);

    if (answersResult.error) throw new Error(`Count query failed: ${answersResult.error.message}`);
    if (playersResult.error) throw new Error(`Player count failed: ${playersResult.error.message}`);

    const submittedCount = answersResult.count ?? 0;
    const playerCount = playersResult.count ?? 0;

    // Determine total questions and current position.
    let totalQuestions = 0;
    let questionPosition: number | null = null;
    let activeGameSetName: string | null = null;

    if (gs.active_game_set_id) {
      // Game-set-aware: count enabled questions, fetch current GSQ and set name in parallel.
      const [gsqCountResult, gsqRowResult, gsRowResult] = await Promise.all([
        db.from('game_set_questions')
          .select('id', { count: 'exact', head: true })
          .eq('game_set_id', gs.active_game_set_id)
          .eq('is_enabled', true),
        gs.current_game_set_question_id
          ? db.from('game_set_questions')
              .select('play_order')
              .eq('id', gs.current_game_set_question_id)
              .single<{ play_order: number }>()
          : Promise.resolve({ data: null, error: null }),
        db.from('game_sets')
          .select('name')
          .eq('id', gs.active_game_set_id)
          .single<{ name: string }>(),
      ]);

      if (gsqCountResult.error) throw new Error(`GSQ count failed: ${gsqCountResult.error.message}`);
      totalQuestions = gsqCountResult.count ?? 0;
      if (gsRowResult.data) activeGameSetName = gsRowResult.data.name;

      if (gsqRowResult.data) {
        const { count: enabledPositionCount, error: enabledPositionErr } = await db
          .from('game_set_questions')
          .select('id', { count: 'exact', head: true })
          .eq('game_set_id', gs.active_game_set_id)
          .eq('is_enabled', true)
          .lte('play_order', gsqRowResult.data.play_order);

        if (enabledPositionErr) throw new Error(`GSQ position failed: ${enabledPositionErr.message}`);
        questionPosition = enabledPositionCount ?? null;
      }
    } else {
      // Legacy fallback: count published questions and position in parallel.
      const [pubCountResult, positionResult] = await Promise.all([
        db.from('questions').select('id', { count: 'exact', head: true }).eq('is_published', true),
        gs.current_question_index != null
          ? db.from('questions')
              .select('id', { count: 'exact', head: true })
              .eq('is_published', true)
              .lte('order_index', gs.current_question_index)
          : Promise.resolve({ count: null, error: null }),
      ]);

      if (pubCountResult.error) throw new Error(`Question count failed: ${pubCountResult.error.message}`);
      if (positionResult.error) throw new Error(`Question position failed: ${positionResult.error.message}`);
      totalQuestions = pubCountResult.count ?? 0;
      questionPosition = positionResult.count ?? null;
    }

    const body: QuestionStatsResponse = {
      status: gs.status,
      question_id: gs.current_question_id,
      question_index: questionPosition,
      total_questions: totalQuestions,
      submitted_count: submittedCount,
      player_count: playerCount,
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
