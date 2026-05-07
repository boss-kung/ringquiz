// get-display-stats — public aggregate stats for the big display screen.
// No auth required. Returns only safe aggregate counts — never raw answer rows,
// individual player data, coordinates, mask paths, or host-secret-protected data.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { normalizeSpecialRuleConfig } from '../_shared/special-rules.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type { FastestFingerWinner, GameState, ErrorResponse, SpecialRuleType } from '../_shared/types.ts';

interface DisplayStatsResponse {
  player_count: number;
  submitted_count: number;
  correct_count: number;
  accuracy: number;             // correct_count / submitted_count * 100, or 0 if no submissions
  question_index: number | null; // play_order in active game set (null in legacy mode)
  total_questions: number;       // enabled questions in active game set (0 in legacy)
  current_question_id: string | null;
  active_game_set_id: string | null;
  fastest_finger_winners: FastestFingerWinner[];
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
    let fastestFingerWinners: FastestFingerWinner[] = [];

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
      totalQuestions = totalRes.count ?? 0;

      if (posRes.data) {
        const { count: enabledPositionCount, error: enabledPositionErr } = await db
          .from('game_set_questions')
          .select('id', { count: 'exact', head: true })
          .eq('game_set_id', gs.active_game_set_id)
          .eq('is_enabled', true)
          .lte('play_order', posRes.data.play_order);

        if (enabledPositionErr) throw new Error(`Game-set position failed: ${enabledPositionErr.message}`);
        questionIndex = enabledPositionCount ?? null;
      }

      if (gs.current_game_set_question_id && gs.current_question_id) {
        const { data: ruleRow, error: ruleErr } = await db
          .from('game_set_questions')
          .select('special_rule_type, special_rule_config')
          .eq('id', gs.current_game_set_question_id)
          .single<{ special_rule_type: SpecialRuleType; special_rule_config: Record<string, unknown> | null }>();

        if (ruleErr) throw new Error(`Special rule lookup failed: ${ruleErr.message}`);

        if (ruleRow.special_rule_type === 'fastest_finger') {
          const config = normalizeSpecialRuleConfig('fastest_finger', ruleRow.special_rule_config ?? {});
          const topN = config.top_n ?? 3;
          const bonusPoints = config.bonus_points ?? 300;
          const { data: winnerRows, error: winnersErr } = await db
            .from('answers')
            .select('player_id, players!inner(display_name)')
            .eq('question_id', gs.current_question_id)
            .eq('is_correct', true)
            .order('submitted_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(topN);

          if (winnersErr) throw new Error(`Fastest finger winners failed: ${winnersErr.message}`);

          fastestFingerWinners = (winnerRows ?? []).map((row, index) => {
            const players = (row as Record<string, unknown>).players;
            const displayName = Array.isArray(players)
              ? (((players as Array<Record<string, unknown>>)[0]?.display_name as string | undefined) ?? 'Player')
              : (((players as Record<string, unknown> | null)?.display_name as string | undefined) ?? 'Player');
            return {
              rank: index + 1,
              player_id: row.player_id,
              display_name: displayName,
              bonus_points: bonusPoints,
            };
          });
        }
      }
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
      fastest_finger_winners: fastestFingerWinners,
    };

    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[get-display-stats]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
