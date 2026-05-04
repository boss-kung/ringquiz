// get-display-stats — public aggregate stats for the big display screen.
// No auth required. Returns only safe aggregate counts — never raw answer rows,
// individual player data, coordinates, mask paths, or host-secret-protected data.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type { GameState, ErrorResponse } from '../_shared/types.ts';

interface DisplayStatsResponse {
  player_count: number;
  submitted_count: number;
  correct_count: number;
  accuracy: number;             // correct_count / submitted_count * 100, or 0 if no submissions
  question_index: number | null; // play_order in active game set (null in legacy mode)
  total_questions: number;       // enabled questions in active game set (0 in legacy)
  current_question_id: string | null;
  active_game_set_id: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const db = getSupabaseAdmin();

  try {
    // Read current game state (service role bypasses RLS)
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('current_question_id, active_game_set_id, current_game_set_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'current_question_id' | 'active_game_set_id' | 'current_game_set_question_id'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    // Count total joined players
    const { count: playerCount } = await db
      .from('players')
      .select('id', { count: 'exact', head: true });

    // Count submitted and correct answers for current question
    let submittedCount = 0;
    let correctCount = 0;

    if (gs.current_question_id) {
      const [submitRes, correctRes] = await Promise.all([
        db.from('answers')
          .select('id', { count: 'exact', head: true })
          .eq('question_id', gs.current_question_id),
        db.from('answers')
          .select('id', { count: 'exact', head: true })
          .eq('question_id', gs.current_question_id)
          .eq('is_correct', true),
      ]);
      submittedCount = submitRes.count ?? 0;
      correctCount = correctRes.count ?? 0;
    }

    const accuracy = submittedCount > 0
      ? Math.round((correctCount / submittedCount) * 1000) / 10   // one decimal place
      : 0;

    // Current play position and total in the game set
    let questionIndex: number | null = null;
    let totalQuestions = 0;

    if (gs.active_game_set_id) {
      const [posRes, totalRes] = await Promise.all([
        gs.current_game_set_question_id
          ? db.from('game_set_questions')
              .select('play_order')
              .eq('id', gs.current_game_set_question_id)
              .single<{ play_order: number }>()
          : Promise.resolve({ data: null, error: null }),
        db.from('game_set_questions')
          .select('id', { count: 'exact', head: true })
          .eq('game_set_id', gs.active_game_set_id)
          .eq('is_enabled', true),
      ]);
      if (posRes.data) questionIndex = posRes.data.play_order;
      totalQuestions = totalRes.count ?? 0;
    }

    const body: DisplayStatsResponse = {
      player_count: playerCount ?? 0,
      submitted_count: submittedCount,
      correct_count: correctCount,
      accuracy,
      question_index: questionIndex,
      total_questions: totalQuestions,
      current_question_id: gs.current_question_id,
      active_game_set_id: gs.active_game_set_id,
    };

    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[get-display-stats]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
