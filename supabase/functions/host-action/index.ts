// host-action — all host state transitions.
// Auth: X-Host-Secret header (validated against HOST_SECRET env var).
//
// Game-set-aware navigation (Phase 2+):
//   - start_countdown and next_question use the active game set's enabled
//     questions ordered by play_order, not questions.order_index.
//   - open_question uses game_set_questions.time_limit_seconds.
//   - close_question passes current_game_set_question_id to compute_leaderboard
//     so cumulative scores respect game-set ordering.
//
// Backward compat:
//   - current_question_id is still updated for players to fetch question content.
//   - current_question_index mirrors play_order (was order_index).
//   - If no active game set exists, falls back to legacy questions.order_index.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { normalizeSpecialRuleConfig } from '../_shared/special-rules.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type {
  FastestFingerWinner,
  GameState,
  GameStatus,
  DisplayTheme,
  HostActionName,
  HostActionRequest,
  HostActionResponse,
  ErrorResponse,
  ScoreBreakdownItem,
  SpecialRuleType,
} from '../_shared/types.ts';

const GAME_STATE_ID = '00000000-0000-0000-0000-000000000001';

const ACTION_ALIASES: Record<string, HostActionName> = {
  hype_cheer: 'trigger_hype_cheer',
  spotlight_leaderboard: 'trigger_spotlight_leaderboard',
  final_drumroll: 'trigger_final_drumroll',
  display_theme: 'set_display_theme',
  set_theme: 'set_display_theme',
};

// ---------------------------------------------------------------------------
// Valid from-states per action.
// ---------------------------------------------------------------------------

const VALID_FROM: Record<HostActionName, GameStatus[] | '*'> = {
  start_countdown:              ['waiting', 'leaderboard'],
  open_question:                ['countdown'],
  close_question:               ['question_open', 'question_closed'],
  show_reveal:                  ['question_closed', 'reveal'],
  show_leaderboard:             ['reveal', 'leaderboard'],
  next_question:                ['leaderboard'],
  end_game:                     ['countdown', 'question_open', 'question_closed', 'reveal', 'leaderboard', 'ended'],
  soft_reset_game:              '*',
  hard_reset_game:              '*',
  force_close_question:         ['question_open', 'question_closed'],
  recompute_leaderboard:        ['question_closed', 'reveal', 'leaderboard'],
  // Visual FX — can fire at any game state; never affect game_state.status
  trigger_hype_cheer:           '*',
  trigger_spotlight_leaderboard:'*',
  trigger_final_drumroll:       '*',
  set_display_theme:            '*',
};

const TRANSITION_TARGET: Partial<Record<HostActionName, GameStatus>> = {
  start_countdown:      'countdown',
  open_question:        'question_open',
  close_question:       'question_closed',
  force_close_question: 'question_closed',
  show_reveal:          'reveal',
  show_leaderboard:     'leaderboard',
  next_question:        'countdown',
  end_game:             'ended',
  soft_reset_game:      'waiting',
  hard_reset_game:      'waiting',
  // FX actions have no target status — they do not advance game flow
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const envSecret = Deno.env.get('HOST_SECRET')?.trim();
  if (!envSecret) return error(500, 'server_missing_host_secret');
  const providedSecret = req.headers.get('X-Host-Secret')?.trim();
  if (!providedSecret || providedSecret !== envSecret) {
    await sleep(300);
    return error(401, 'unauthorized');
  }

  let body: HostActionRequest;
  try {
    body = await req.json();
  } catch {
    return error(400, 'invalid_json');
  }

  if (!body?.action) return error(400, 'missing_action');

  const action = normalizeAction(body.action);
  if (!VALID_FROM[action]) return error(400, 'unknown_action');

  const db = getSupabaseAdmin();

  try {
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('*')
      .eq('id', GAME_STATE_ID)
      .single<GameState>();

    if (gsErr || !gs) throw new Error(`Failed to read game_state: ${gsErr?.message}`);

    const validFrom = VALID_FROM[action];
    if (validFrom !== '*' && !validFrom.includes(gs.status)) {
      return Response.json(
        { error: 'invalid_transition', from: gs.status, action } satisfies ErrorResponse,
        { status: 409, headers: corsHeaders },
      );
    }

    return await executeAction(action, gs, db, body.payload);
  } catch (err) {
    console.error('[host-action]', action, err);
    return error(500, 'internal', String(err));
  }
});

// ---------------------------------------------------------------------------
// Action executor
// ---------------------------------------------------------------------------

async function executeAction(
  action: HostActionName,
  gs: GameState,
  db: ReturnType<typeof getSupabaseAdmin>,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const targetStatus = TRANSITION_TARGET[action];
  const alreadyInState = targetStatus !== undefined && gs.status === targetStatus;

  switch (action) {

    // ── start_countdown ──────────────────────────────────────────────────────
    // Advances to the first enabled question in the active game set
    // (or first published question by order_index if no game set is active).
    case 'start_countdown': {
      const currentPlayOrder = gs.current_question_index ?? -1;

      if (gs.active_game_set_id) {
        // Intentionally do not filter on questions.is_published here.
        // Hard reset should restart from the first enabled play_order in the
        // active game set, even if the bank question is unpublished.
        const nextGSQ = await selectNextGameSetQuestion(gs.active_game_set_id, currentPlayOrder, db);
        if (!nextGSQ) return error(400, 'no_next_question');

        if (!alreadyInState) {
          await updateGameState(db, {
            status: 'countdown',
            current_question_id: nextGSQ.question_id,
            current_question_index: nextGSQ.play_order,
            current_game_set_question_id: nextGSQ.id,
            question_started_at: null,
            question_ends_at: null,
          });
        }
      } else {
        // Legacy fallback: use questions.order_index
        const { data: nextQ, error: qErr } = await db
          .from('questions')
          .select('id, order_index')
          .eq('is_published', true)
          .gt('order_index', currentPlayOrder)
          .order('order_index', { ascending: true })
          .limit(1)
          .single();

        if (qErr || !nextQ) return error(400, 'no_next_question');

        if (!alreadyInState) {
          await updateGameState(db, {
            status: 'countdown',
            current_question_id: nextQ.id,
            current_question_index: nextQ.order_index,
            current_game_set_question_id: null,
            question_started_at: null,
            question_ends_at: null,
          });
        }
      }

      return ok(action, 'countdown', alreadyInState, await refetchGs(db));
    }

    // ── open_question ────────────────────────────────────────────────────────
    // Sets authoritative timer using game_set_questions.time_limit_seconds.
    case 'open_question': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      let timeLimitSeconds: number;

      if (gs.current_game_set_question_id) {
        // Use snapshot time from game set
        const { data: gsq, error: gqErr } = await db
          .from('game_set_questions')
          .select('time_limit_seconds')
          .eq('id', gs.current_game_set_question_id)
          .single();

        if (gqErr || !gsq) return error(400, 'no_current_question');
        timeLimitSeconds = gsq.time_limit_seconds;
      } else {
        // Legacy fallback: use questions table
        const { data: q, error: qErr } = await db
          .from('questions')
          .select('time_limit_seconds')
          .eq('id', gs.current_question_id)
          .single();

        if (qErr || !q) return error(400, 'no_current_question');
        timeLimitSeconds = q.time_limit_seconds;
      }

      if (!alreadyInState) {
        const now = new Date();
        const endsAt = new Date(now.getTime() + timeLimitSeconds * 1000);
        await updateGameState(db, {
          status: 'question_open',
          question_started_at: now.toISOString(),
          question_ends_at: endsAt.toISOString(),
        });
      }

      return ok(action, 'question_open', alreadyInState, await refetchGs(db));
    }

    // ── close_question / force_close_question ────────────────────────────────
    // Passes game_set_question_id to compute_leaderboard for game-set-ordered
    // cumulative scoring.
    case 'close_question':
    case 'force_close_question': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      if (!alreadyInState) {
        await updateGameState(db, { status: 'question_closed' });
      }

      await applyFastestFingerBonusIfNeeded(db, gs.current_question_id, gs.current_game_set_question_id ?? null);

      const { data: count, error: lbErr } = await db
        .rpc('compute_leaderboard', {
          p_question_id: gs.current_question_id,
          p_game_set_question_id: gs.current_game_set_question_id ?? undefined,
        });

      if (lbErr) throw new Error(`compute_leaderboard failed: ${lbErr.message}`);

      return ok(action, 'question_closed', alreadyInState, await refetchGs(db), {
        entries_written: count as number,
      });
    }

    // ── show_reveal ──────────────────────────────────────────────────────────
    // Recomputes the leaderboard on every reveal to pick up answers that arrived
    // within the 2-second grace window after close_question was called.
    case 'show_reveal': {
      if (!alreadyInState) await updateGameState(db, { status: 'reveal' });

      if (gs.current_question_id) {
        await applyFastestFingerBonusIfNeeded(db, gs.current_question_id, gs.current_game_set_question_id ?? null);
        const { error: lbErr } = await db.rpc('compute_leaderboard', {
          p_question_id: gs.current_question_id,
          p_game_set_question_id: gs.current_game_set_question_id ?? undefined,
        });
        if (lbErr) console.warn('[show_reveal] recompute_leaderboard failed:', lbErr.message);
      }

      return ok(action, 'reveal', alreadyInState, await refetchGs(db));
    }

    // ── show_leaderboard ─────────────────────────────────────────────────────
    case 'show_leaderboard': {
      if (!alreadyInState) await updateGameState(db, { status: 'leaderboard' });
      return ok(action, 'leaderboard', alreadyInState, await refetchGs(db));
    }

    // ── next_question ────────────────────────────────────────────────────────
    // Advances to the next enabled question in the active game set.
    case 'next_question': {
      const currentPlayOrder = gs.current_question_index ?? -1;

      if (gs.active_game_set_id) {
        const nextGSQ = await selectNextGameSetQuestion(gs.active_game_set_id, currentPlayOrder, db);
        if (!nextGSQ) return error(400, 'no_next_question');

        await updateGameState(db, {
          status: 'countdown',
          current_question_id: nextGSQ.question_id,
          current_question_index: nextGSQ.play_order,
          current_game_set_question_id: nextGSQ.id,
          question_started_at: null,
          question_ends_at: null,
        });
      } else {
        // Legacy fallback
        const { data: nextQ, error: qErr } = await db
          .from('questions')
          .select('id, order_index')
          .eq('is_published', true)
          .gt('order_index', currentPlayOrder)
          .order('order_index', { ascending: true })
          .limit(1)
          .single();

        if (qErr || !nextQ) return error(400, 'no_next_question');

        await updateGameState(db, {
          status: 'countdown',
          current_question_id: nextQ.id,
          current_question_index: nextQ.order_index,
          current_game_set_question_id: null,
          question_started_at: null,
          question_ends_at: null,
        });
      }

      return ok(action, 'countdown', false, await refetchGs(db));
    }

    // ── end_game ─────────────────────────────────────────────────────────────
    case 'end_game': {
      if (!alreadyInState) {
        await updateGameState(db, { status: 'ended' });
      }

      let entriesWritten: number | undefined;
      if (gs.current_question_id) {
        await applyFastestFingerBonusIfNeeded(db, gs.current_question_id, gs.current_game_set_question_id ?? null);
        const { data: count, error: lbErr } = await db
          .rpc('compute_leaderboard', {
            p_question_id: gs.current_question_id,
            p_game_set_question_id: gs.current_game_set_question_id ?? undefined,
          });

        if (lbErr) throw new Error(`end_game leaderboard compute failed: ${lbErr.message}`);
        entriesWritten = count as number;
      }

      return ok(action, 'ended', alreadyInState, await refetchGs(db), {
        entries_written: entriesWritten,
      });
    }

    // ── soft_reset_game ──────────────────────────────────────────────────────
    // Clears answers, leaderboard, player scores. Keeps questions & game sets.
    case 'soft_reset_game': {
      // leaderboard_snapshot and answers have no FK dependency on each other —
      // delete them in parallel, then reset player scores.
      const [{ error: err1 }, { error: err2 }] = await Promise.all([
        db.from('leaderboard_snapshot').delete().not('question_id', 'is', null),
        db.from('answers').delete().not('id', 'is', null),
      ]);
      if (err1) throw new Error(`soft_reset: leaderboard_snapshot delete failed: ${err1.message}`);
      if (err2) throw new Error(`soft_reset: answers delete failed: ${err2.message}`);

      const { error: err3 } = await db.from('players').update({ total_score: 0 }).not('id', 'is', null);
      if (err3) throw new Error(`soft_reset: players total_score reset failed: ${err3.message}`);

      await updateGameState(db, {
        status: 'waiting',
        current_question_id: null,
        current_question_index: null,
        current_game_set_question_id: null,
        question_started_at: null,
        question_ends_at: null,
      });

      return ok(action, 'waiting', false, await refetchGs(db));
    }

    // ── hard_reset_game ──────────────────────────────────────────────────────
    // Full reset: clears answers, leaderboard, players. Keeps questions & game sets.
    case 'hard_reset_game': {
      // leaderboard_snapshot and answers have no FK dependency on each other —
      // delete them in parallel. answers FK → players, so players must wait.
      const [{ error: err1 }, { error: err2 }] = await Promise.all([
        db.from('leaderboard_snapshot').delete().not('question_id', 'is', null),
        db.from('answers').delete().not('id', 'is', null),
      ]);
      if (err1) throw new Error(`hard_reset: leaderboard_snapshot delete failed: ${err1.message}`);
      if (err2) throw new Error(`hard_reset: answers delete failed: ${err2.message}`);

      const { error: err3 } = await db.from('players').delete().not('id', 'is', null);
      if (err3) throw new Error(`hard_reset: players delete failed: ${err3.message}`);

      const { error: incrementErr } = await db.rpc('increment_game_session_version');
      if (incrementErr) console.warn('hard_reset: session_version increment non-critical failure:', incrementErr.message);

      await updateGameState(db, {
        status: 'waiting',
        current_question_id: null,
        current_question_index: null,
        current_game_set_question_id: null,
        question_started_at: null,
        question_ends_at: null,
      });

      return ok(action, 'waiting', false, await refetchGs(db));
    }

    // ── recompute_leaderboard ────────────────────────────────────────────────
    case 'recompute_leaderboard': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      await applyFastestFingerBonusIfNeeded(db, gs.current_question_id, gs.current_game_set_question_id ?? null);

      const { data: count, error: lbErr } = await db
        .rpc('compute_leaderboard', {
          p_question_id: gs.current_question_id,
          p_game_set_question_id: gs.current_game_set_question_id ?? undefined,
        });

      if (lbErr) throw new Error(`recompute_leaderboard failed: ${lbErr.message}`);

      return ok(action, gs.status, false, await refetchGs(db), {
        entries_written: count as number,
      });
    }

    // ── trigger_hype_cheer ───────────────────────────────────────────────────
    // Inserts a display_events row; Display subscribes and shows a 2s cheer banner.
    // Never touches game_state.status.
    case 'trigger_hype_cheer': {
      const { error: insErr } = await db.from('display_events').insert({
        event_type: 'hype_cheer',
        payload: {},
        created_by: 'host',
      });
      if (insErr) throw new Error(`trigger_hype_cheer insert failed: ${insErr.message}`);
      return ok(action, gs.status, false, gs);
    }

    // ── trigger_spotlight_leaderboard ────────────────────────────────────────
    case 'trigger_spotlight_leaderboard': {
      const { error: insErr } = await db.from('display_events').insert({
        event_type: 'spotlight_leaderboard',
        payload: {},
        created_by: 'host',
      });
      if (insErr) throw new Error(`trigger_spotlight_leaderboard insert failed: ${insErr.message}`);
      return ok(action, gs.status, false, gs);
    }

    // ── trigger_final_drumroll ───────────────────────────────────────────────
    case 'trigger_final_drumroll': {
      const { error: insErr } = await db.from('display_events').insert({
        event_type: 'final_drumroll',
        payload: {},
        created_by: 'host',
      });
      if (insErr) throw new Error(`trigger_final_drumroll insert failed: ${insErr.message}`);
      return ok(action, gs.status, false, gs);
    }

    // ── set_display_theme ────────────────────────────────────────────────────
    // Updates game_state.display_theme so the Big Screen persists it on reload.
    // Also inserts a theme_change display_event for instant Realtime delivery.
    case 'set_display_theme': {
      const VALID_THEMES: DisplayTheme[] = ['classic_gold', 'neon_night', 'danger_round', 'final_round'];
      const theme = payload?.theme as string | undefined;
      if (!theme || !VALID_THEMES.includes(theme as DisplayTheme)) {
        return error(400, 'invalid_payload', `payload.theme must be one of: ${VALID_THEMES.join(', ')}`);
      }
      await updateGameState(db, { display_theme: theme as DisplayTheme });
      const { error: insErr } = await db.from('display_events').insert({
        event_type: 'theme_change',
        payload: { theme },
        created_by: 'host',
      });
      if (insErr) console.warn('[host-action] theme_change event insert non-critical:', insErr.message);
      return ok(action, gs.status, false, await refetchGs(db));
    }

    default:
      return error(400, 'unknown_action');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateGameState(
  db: ReturnType<typeof getSupabaseAdmin>,
  patch: Partial<GameState>,
): Promise<void> {
  const { error } = await db
    .from('game_state')
    .update(patch)
    .eq('id', GAME_STATE_ID);
  if (error) throw new Error(`updateGameState failed: ${error.message}`);
}

async function refetchGs(
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<GameState> {
  const { data, error } = await db
    .from('game_state')
    .select('*')
    .eq('id', GAME_STATE_ID)
    .single<any>();
  if (error || !data) throw new Error(`refetch game_state failed: ${error?.message}`);
  return {
    ...data,
    session_version: data.session_version ?? 1,
    active_game_set_id: data.active_game_set_id ?? null,
    current_game_set_question_id: data.current_game_set_question_id ?? null,
    display_theme: data.display_theme ?? 'classic_gold',
  } as GameState;
}

type NextGameSetQuestion = {
  id: string;
  question_id: string;
  play_order: number;
};

async function selectNextGameSetQuestion(
  gameSetId: string,
  currentPlayOrder: number,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<NextGameSetQuestion | null> {
  const { data, error } = await db
    .from('game_set_questions')
    .select(`
      id,
      question_id,
      play_order,
      questions!inner(id)
    `)
    .eq('game_set_id', gameSetId)
    .eq('is_enabled', true)
    .gt('play_order', currentPlayOrder)
    .order('play_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`game_set_questions query failed: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    question_id: data.question_id,
    play_order: data.play_order,
  };
}

async function applyFastestFingerBonusIfNeeded(
  db: ReturnType<typeof getSupabaseAdmin>,
  questionId: string,
  gameSetQuestionId: string | null,
): Promise<FastestFingerWinner[]> {
  if (!gameSetQuestionId) return [];

  const { data: gsq, error: gsqErr } = await db
    .from('game_set_questions')
    .select('special_rule_type, special_rule_config')
    .eq('id', gameSetQuestionId)
    .single<{ special_rule_type: SpecialRuleType; special_rule_config: Record<string, unknown> | null }>();

  if (gsqErr || !gsq) throw new Error(`fastest_finger config lookup failed: ${gsqErr?.message}`);
  if (gsq.special_rule_type !== 'fastest_finger') return [];

  const config = normalizeSpecialRuleConfig('fastest_finger', gsq.special_rule_config ?? {});
  const topN = config.top_n ?? 3;
  const bonusPoints = config.bonus_points ?? 300;

  const { data: winners, error: winnersErr } = await db
    .from('answers')
    .select('id, player_id, score, score_breakdown, special_bonus_applied, submitted_at, players!inner(display_name)')
    .eq('question_id', questionId)
    .eq('is_correct', true)
    .order('submitted_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(topN);

  if (winnersErr) throw new Error(`fastest_finger winners lookup failed: ${winnersErr.message}`);
  if (!winners || winners.length === 0) return [];

  const appliedWinners: FastestFingerWinner[] = [];
  for (const [index, winner] of winners.entries()) {
    const displayName = Array.isArray((winner as Record<string, unknown>).players)
      ? (((winner as Record<string, unknown>).players as Array<Record<string, unknown>>)[0]?.display_name as string | undefined) ?? 'Player'
      : ((((winner as Record<string, unknown>).players as Record<string, unknown> | null)?.display_name as string | undefined) ?? 'Player');

    appliedWinners.push({
      rank: index + 1,
      player_id: winner.player_id,
      display_name: displayName,
      bonus_points: bonusPoints,
    });

    if (winner.special_bonus_applied) continue;

    const currentBreakdown = Array.isArray(winner.score_breakdown)
      ? [...(winner.score_breakdown as ScoreBreakdownItem[])]
      : [];
    const nextBreakdown = currentBreakdown.filter((item) => item.type !== 'fastest_finger' && item.type !== 'final');
    nextBreakdown.push({
      type: 'fastest_finger',
      label: 'Fastest Finger Bonus',
      value: bonusPoints,
      operation: `+${bonusPoints}`,
    });
    nextBreakdown.push({
      type: 'final',
      label: 'Final Score',
      value: winner.score + bonusPoints,
    });

    const { data: updatedWinner, error: updateErr } = await db
      .from('answers')
      .update({
        score: winner.score + bonusPoints,
        score_breakdown: nextBreakdown,
        special_bonus_applied: true,
      })
      .eq('id', winner.id)
      .eq('special_bonus_applied', false)
      .select('id')
      .maybeSingle();

    if (updateErr) throw new Error(`fastest_finger bonus update failed: ${updateErr.message}`);
    if (!updatedWinner) continue;

    const { error: playerScoreErr } = await db.rpc('increment_player_score', {
      p_player_id: winner.player_id,
      p_amount: bonusPoints,
    });
    if (playerScoreErr) throw new Error(`fastest_finger player total update failed: ${playerScoreErr.message}`);
  }

  return appliedWinners;
}

function ok(
  action: HostActionName,
  status: GameStatus,
  alreadyInState: boolean,
  gs: GameState,
  extras: { entries_written?: number } = {},
): Response {
  const body: HostActionResponse = {
    ok: true,
    action,
    status,
    already_in_state: alreadyInState,
    question_id: gs.current_question_id,
    question_index: gs.current_question_index,
    question_started_at: gs.question_started_at,
    question_ends_at: gs.question_ends_at,
    ...extras,
  };
  return Response.json(body, { headers: corsHeaders });
}

function error(
  status: number,
  code: string,
  detail?: string,
): Response {
  const body: ErrorResponse = { error: code, ...(detail ? { detail } : {}) };
  return Response.json(body, { status, headers: corsHeaders });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAction(action: unknown): HostActionName {
  if (typeof action !== 'string') return '' as HostActionName;
  return (ACTION_ALIASES[action] ?? action) as HostActionName;
}
