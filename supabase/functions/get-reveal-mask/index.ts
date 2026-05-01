// get-reveal-mask — proxies the mask PNG from private storage during reveal state.
// Only works when game state is 'reveal'. Returns the raw PNG bytes.
// Safe to expose during reveal — showing the correct zone is intentional.
// mask_storage_path is never included in any response.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type { GameState, QuestionMask, ErrorResponse } from '../_shared/types.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const db = getSupabaseAdmin();

  try {
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'status' | 'current_question_id'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    if (gs.status !== 'reveal') {
      const body: ErrorResponse = { error: 'not_in_reveal_state' };
      return Response.json(body, { status: 409, headers: corsHeaders });
    }

    if (!gs.current_question_id) {
      const body: ErrorResponse = { error: 'no_current_question' };
      return Response.json(body, { status: 400, headers: corsHeaders });
    }

    const { data: maskRow, error: maskErr } = await db
      .from('question_masks')
      .select('mask_storage_path')
      .eq('question_id', gs.current_question_id)
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
