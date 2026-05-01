// host-action — all host state transitions.
// Auth: X-Host-Secret header (validated against HOST_SECRET env var).
// The host browser has no elevated Supabase auth. All privileged DB writes
// happen here using the service role client, which bypasses RLS.
//
// State machine enforced here — clients cannot skip or reverse states.
// All mutating actions are idempotent: calling twice gives the same result.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type {
  GameState,
  GameStatus,
  HostActionName,
  HostActionRequest,
  HostActionResponse,
  ErrorResponse,
} from '../_shared/types.ts';

// ---------------------------------------------------------------------------
// Valid from-states per action.
// '*' means the action is valid from any state.
// Target state is listed in TRANSITION_TARGET.
// ---------------------------------------------------------------------------

const VALID_FROM: Record<HostActionName, GameStatus[] | '*'> = {
  start_countdown:       ['waiting', 'leaderboard'],
  open_question:         ['countdown'],
  close_question:        ['question_open', 'question_closed'],  // question_closed = idempotent
  show_reveal:           ['question_closed', 'reveal'],          // reveal = idempotent
  show_leaderboard:      ['reveal', 'leaderboard'],              // leaderboard = idempotent
  next_question:         ['leaderboard'],
  end_game:              ['leaderboard', 'ended'],               // ended = idempotent
  soft_reset_game:       '*',                                    // restart round, keep players
  hard_reset_game:       '*',                                    // full reset, force re-login
  force_close_question:  ['question_open', 'question_closed'],
  recompute_leaderboard: ['question_closed', 'reveal', 'leaderboard'],
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
  // recompute_leaderboard has no target (state unchanged)
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  // 1. Auth: HOST_SECRET
  const providedSecret = req.headers.get('X-Host-Secret');
  if (!providedSecret || providedSecret !== Deno.env.get('HOST_SECRET')) {
    return error(401, 'unauthorized');
  }

  // 2. Parse body
  let body: HostActionRequest;
  try {
    body = await req.json();
  } catch {
    return error(400, 'invalid_json');
  }

  if (!body?.action) return error(400, 'missing_action');

  const action = body.action as HostActionName;
  if (!VALID_FROM[action]) return error(400, 'unknown_action');

  const db = getSupabaseAdmin();

  try {
    // 3. Fetch current game state
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<GameState>();

    if (gsErr || !gs) throw new Error(`Failed to read game_state: ${gsErr?.message}`);

    // 4. Validate transition
    const validFrom = VALID_FROM[action];
    if (validFrom !== '*' && !validFrom.includes(gs.status)) {
      return Response.json(
        {
          error: 'invalid_transition',
          from: gs.status,
          action,
        } satisfies ErrorResponse,
        { status: 409, headers: corsHeaders },
      );
    }

    // 5. Execute action
    return await executeAction(action, gs, db);
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
): Promise<Response> {
  const targetStatus = TRANSITION_TARGET[action];
  const alreadyInState = targetStatus !== undefined && gs.status === targetStatus;

  switch (action) {
    // ── start_countdown ────────────────────────────────────────────────────
    // Advances to the first published question (from waiting)
    // or the next published question after the current one (from leaderboard).
    case 'start_countdown': {
      const currentIndex = gs.current_question_index ?? -1;
      const { data: nextQ, error: qErr } = await db
        .from('questions')
        .select('id, order_index')
        .eq('is_published', true)
        .gt('order_index', currentIndex)
        .order('order_index', { ascending: true })
        .limit(1)
        .single();

      if (qErr || !nextQ) return error(400, 'no_next_question');

      if (!alreadyInState) {
        await updateGameState(db, {
          status: 'countdown',
          current_question_id: nextQ.id,
          current_question_index: nextQ.order_index,
        });
      }

      return ok(action, 'countdown', alreadyInState, await refetchGs(db));
    }

    // ── open_question ──────────────────────────────────────────────────────
    // Sets authoritative server timestamps for scoring.
    case 'open_question': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      const { data: q, error: qErr } = await db
        .from('questions')
        .select('time_limit_seconds')
        .eq('id', gs.current_question_id)
        .single();

      if (qErr || !q) return error(400, 'no_current_question');

      if (!alreadyInState) {
        const now = new Date();
        const endsAt = new Date(now.getTime() + q.time_limit_seconds * 1000);
        await updateGameState(db, {
          status: 'question_open',
          question_started_at: now.toISOString(),
          question_ends_at: endsAt.toISOString(),
        });
      }

      return ok(action, 'question_open', alreadyInState, await refetchGs(db));
    }

    // ── close_question / force_close_question ──────────────────────────────
    // Transitions to question_closed and runs leaderboard computation.
    // Both actions behave identically. force_close is for emergency use.
    // compute_leaderboard is idempotent — safe to run even if already closed.
    case 'close_question':
    case 'force_close_question': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      if (!alreadyInState) {
        await updateGameState(db, { status: 'question_closed' });
      }

      const { data: count, error: lbErr } = await db
        .rpc('compute_leaderboard', { p_question_id: gs.current_question_id });

      if (lbErr) throw new Error(`compute_leaderboard failed: ${lbErr.message}`);

      return ok(action, 'question_closed', alreadyInState, await refetchGs(db), {
        entries_written: count as number,
      });
    }

    // ── show_reveal ────────────────────────────────────────────────────────
    case 'show_reveal': {
      if (!alreadyInState) await updateGameState(db, { status: 'reveal' });
      return ok(action, 'reveal', alreadyInState, await refetchGs(db));
    }

    // ── show_leaderboard ───────────────────────────────────────────────────
    case 'show_leaderboard': {
      if (!alreadyInState) await updateGameState(db, { status: 'leaderboard' });
      return ok(action, 'leaderboard', alreadyInState, await refetchGs(db));
    }

    // ── next_question ──────────────────────────────────────────────────────
    // Advances current_question_index. Falls through to start_countdown logic.
    case 'next_question': {
      const currentIndex = gs.current_question_index ?? -1;
      const { data: nextQ, error: qErr } = await db
        .from('questions')
        .select('id, order_index')
        .eq('is_published', true)
        .gt('order_index', currentIndex)
        .order('order_index', { ascending: true })
        .limit(1)
        .single();

      if (qErr || !nextQ) return error(400, 'no_next_question');

      await updateGameState(db, {
        status: 'countdown',
        current_question_id: nextQ.id,
        current_question_index: nextQ.order_index,
        question_started_at: null,
        question_ends_at: null,
      });

      return ok(action, 'countdown', false, await refetchGs(db));
    }

    // ── end_game ───────────────────────────────────────────────────────────
    case 'end_game': {
      if (!alreadyInState) await updateGameState(db, { status: 'ended' });
      return ok(action, 'ended', alreadyInState, await refetchGs(db));
    }

    // ── soft_reset_game ───────────────────────────────────────────────────
    // Clears answers, leaderboard_snapshot, and resets player scores.
    // Keeps questions, question_masks, and player rows intact.
    // Players can auto-rejoin with their existing session if they refresh.
    case 'soft_reset_game': {
      const { error: err1 } = await db.from('leaderboard_snapshot').delete().not('question_id', 'is', null);
      if (err1) throw new Error(`soft_reset: leaderboard_snapshot delete failed: ${err1.message}`);

      const { error: err2 } = await db.from('answers').delete().not('id', 'is', null);
      if (err2) throw new Error(`soft_reset: answers delete failed: ${err2.message}`);

      const { error: err3 } = await db.from('players').update({ total_score: 0 }).not('id', 'is', null);
      if (err3) throw new Error(`soft_reset: players total_score reset failed: ${err3.message}`);

      await updateGameState(db, {
        status: 'waiting',
        current_question_id: null,
        current_question_index: null,
        question_started_at: null,
        question_ends_at: null,
      });

      return ok(action, 'waiting', false, await refetchGs(db));
    }

    // ── hard_reset_game ───────────────────────────────────────────────────
    // Full reset: clears answers, leaderboard_snapshot, players, and resets scores.
    // Also increments session_version to force all players back to name input screen.
    // Players cannot auto-rejoin — they must enter their name again.
    case 'hard_reset_game': {
      const { error: err1 } = await db.from('leaderboard_snapshot').delete().not('question_id', 'is', null);
      if (err1) throw new Error(`hard_reset: leaderboard_snapshot delete failed: ${err1.message}`);

      const { error: err2 } = await db.from('answers').delete().not('id', 'is', null);
      if (err2) throw new Error(`hard_reset: answers delete failed: ${err2.message}`);

      const { error: err3 } = await db.from('players').delete().not('id', 'is', null);
      if (err3) throw new Error(`hard_reset: players delete failed: ${err3.message}`);

      // Increment session_version with raw SQL to avoid column-not-found errors
      const { error: incrementErr } = await db.rpc('increment_game_session_version');
      // Non-critical: if RPC fails, session_version might not exist yet. Continue anyway.
      if (incrementErr) console.warn('hard_reset: session_version increment non-critical failure:', incrementErr.message);

      await updateGameState(db, {
        status: 'waiting',
        current_question_id: null,
        current_question_index: null,
        question_started_at: null,
        question_ends_at: null,
      });

      return ok(action, 'waiting', false, await refetchGs(db));
    }

    // ── recompute_leaderboard ──────────────────────────────────────────────
    // Re-runs leaderboard computation without changing state.
    case 'recompute_leaderboard': {
      if (!gs.current_question_id) return error(400, 'no_current_question');

      const { data: count, error: lbErr } = await db
        .rpc('compute_leaderboard', { p_question_id: gs.current_question_id });

      if (lbErr) throw new Error(`recompute_leaderboard failed: ${lbErr.message}`);

      return ok(action, gs.status, false, await refetchGs(db), {
        entries_written: count as number,
      });
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
    .eq('id', '00000000-0000-0000-0000-000000000001');
  if (error) throw new Error(`updateGameState failed: ${error.message}`);
}

async function refetchGs(
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<GameState> {
  const { data, error } = await db
    .from('game_state')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .single<any>();
  if (error || !data) throw new Error(`refetch game_state failed: ${error?.message}`);
  // Ensure session_version exists (defaults to 1 if column not yet migrated)
  return {
    ...data,
    session_version: data.session_version ?? 1,
  } as GameState;
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
