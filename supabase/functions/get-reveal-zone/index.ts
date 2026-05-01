// get-reveal-zone — returns the centroid of the correct-answer zone.
// Only works when game state is 'reveal' for the current question.
// No player auth required — the correct zone is intentionally revealed to all players.
//
// Safety contract:
//   Returns ONLY (x_ratio, y_ratio) centroid coordinates.
//   Never returns mask_storage_path, raw pixel data, or mask dimensions.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import { decodePNG } from 'jsr:@img/png/decode';
import type {
  GameState,
  QuestionMask,
  RevealZoneResponse,
  ErrorResponse,
} from '../_shared/types.ts';

// Module-level centroid cache: question_id → {x, y}
const centroidCache = new Map<string, { x: number; y: number }>();

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const db = getSupabaseAdmin();

  try {
    // 1. Read current game state
    const { data: gs, error: gsErr } = await db
      .from('game_state')
      .select('status, current_question_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single<Pick<GameState, 'status' | 'current_question_id'>>();

    if (gsErr || !gs) throw new Error('Failed to read game_state');

    // Only expose correct zone during reveal state
    if (gs.status !== 'reveal') {
      const body: ErrorResponse = { error: 'not_in_reveal_state' };
      return Response.json(body, { status: 409, headers: corsHeaders });
    }

    if (!gs.current_question_id) {
      const body: ErrorResponse = { error: 'no_current_question' };
      return Response.json(body, { status: 400, headers: corsHeaders });
    }

    const questionId = gs.current_question_id;

    // 2. Return cached centroid if available (stable per question)
    if (centroidCache.has(questionId)) {
      const cached = centroidCache.get(questionId)!;
      const body: RevealZoneResponse = { x_ratio: cached.x, y_ratio: cached.y };
      return Response.json(body, { headers: corsHeaders });
    }

    // 3. Fetch mask path from question_masks (service role bypasses RLS)
    const { data: maskRow, error: maskErr } = await db
      .from('question_masks')
      .select('mask_storage_path, mask_width, mask_height')
      .eq('question_id', questionId)
      .single<Pick<QuestionMask, 'mask_storage_path' | 'mask_width' | 'mask_height'>>();

    if (maskErr || !maskRow) {
      const body: ErrorResponse = { error: 'mask_not_found' };
      return Response.json(body, { status: 404, headers: corsHeaders });
    }

    // 4. Download mask PNG from private bucket
    const { data: maskFile, error: downloadErr } = await db.storage
      .from('question-masks')
      .download(maskRow.mask_storage_path);

    if (downloadErr || !maskFile) {
      throw new Error(`Mask download failed: ${downloadErr?.message}`);
    }

    // 5. Decode PNG → raw RGBA pixel data
    const bytes = new Uint8Array(await maskFile.arrayBuffer());
    const result = await decodePNG(bytes);

    if (!result?.header || !result?.body) {
      throw new Error('PNG decode failed');
    }

    const { width, height } = result.header;
    const data = new Uint8Array(result.body);

    // 6. Compute centroid of correct-zone pixels
    //    Correct pixel rule: A > 128 AND (R+G+B)/3 > 200
    let sumX = 0, sumY = 0, count = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        const A = data[i + 3];
        if (A <= 128) continue;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (brightness <= 200) continue;
        sumX += px;
        sumY += py;
        count++;
      }
    }

    if (count === 0) {
      const body: ErrorResponse = { error: 'no_correct_zone_found' };
      return Response.json(body, { status: 422, headers: corsHeaders });
    }

    // Normalize pixel coords to [0, 1] ratios
    const centroid = {
      x: (sumX / count) / width,
      y: (sumY / count) / height,
    };

    centroidCache.set(questionId, centroid);

    const body: RevealZoneResponse = { x_ratio: centroid.x, y_ratio: centroid.y };
    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[get-reveal-zone]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
