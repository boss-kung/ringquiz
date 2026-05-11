// get-reveal-mask — proxies the mask PNG from private storage during reveal state.
// Only works when game state is reveal/leaderboard/ended for the current question.
// Safe to expose during those phases — showing the correct zone is intentional.
// mask_storage_path is never included in any response.
// When X-Host-Secret is provided and valid, state/question guards are bypassed (admin preview).
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type { GameState, QuestionMask, ErrorResponse } from '../_shared/types.ts';

const ALLOWED_STATUSES = new Set(['reveal', 'leaderboard', 'ended']);

function isValidHostSecret(req: Request): boolean {
  const envSecret = Deno.env.get('HOST_SECRET')?.trim();
  if (!envSecret) return false;
  const provided = req.headers.get('X-Host-Secret')?.trim();
  return !!provided && provided === envSecret;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const db = getSupabaseAdmin();
  const url = new URL(req.url);
  const requestedQuestionId = url.searchParams.get('questionId');
  const hostAuthenticated = isValidHostSecret(req);

  try {
    if (!hostAuthenticated) {
      // Public path: enforce game-state and current-question guards.
      const { data: gs, error: gsErr } = await db
        .from('game_state')
        .select('status, current_question_id')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .single<Pick<GameState, 'status' | 'current_question_id'>>();

      if (gsErr || !gs) throw new Error('Failed to read game_state');

      if (!ALLOWED_STATUSES.has(gs.status)) {
        const body: ErrorResponse = { error: 'mask_not_available_yet' };
        return Response.json(body, { status: 409, headers: corsHeaders });
      }

      if (!gs.current_question_id) {
        const body: ErrorResponse = { error: 'no_current_question' };
        return Response.json(body, { status: 400, headers: corsHeaders });
      }

      if (!requestedQuestionId || requestedQuestionId !== gs.current_question_id) {
        const body: ErrorResponse = { error: 'wrong_question' };
        return Response.json(body, { status: 409, headers: corsHeaders });
      }
    } else if (!requestedQuestionId) {
      const body: ErrorResponse = { error: 'missing_question_id' };
      return Response.json(body, { status: 400, headers: corsHeaders });
    }

    const { data: maskRow, error: maskErr } = await db
      .from('question_masks')
      .select('mask_storage_path')
      .eq('question_id', requestedQuestionId)
      .single<Pick<QuestionMask, 'mask_storage_path'>>();

    if (maskErr || !maskRow) {
      const body: ErrorResponse = { error: 'mask_not_found' };
      return Response.json(body, { status: 404, headers: corsHeaders });
    }

    const { data: maskFile, error: downloadErr } = await db.storage
      .from('question-masks')
      .download(maskRow.mask_storage_path);

    if (downloadErr || !maskFile) {
      throw new Error(`Mask download failed: ${downloadErr?.message}`);
    }

    const bytes = await maskFile.arrayBuffer();

    return new Response(bytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });

  } catch (e) {
    console.error('[get-reveal-mask]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
