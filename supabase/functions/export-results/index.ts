// export-results — full data export for host CSV generation and post-event analysis.
// Auth: X-Host-Secret header.
//
// Safety contract:
//   Never returns: mask_storage_path, mask_width, mask_height, question_masks rows,
//   or any signed URLs for the question-masks bucket.
//   answers.selected_x_ratio and selected_y_ratio are included (player coordinates are
//   not sensitive — the mask location is what is sensitive, and it is never returned).
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import type { ExportResultsResponse, ErrorResponse } from '../_shared/types.ts';

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
    // Fetch all data in parallel — none of these queries touch question_masks
    const [playersResult, answersResult, leaderboardResult] = await Promise.all([
      db.from('players')
        .select('id, display_name, total_score, joined_at')
        .order('total_score', { ascending: false }),

      db.from('answers')
        .select(
          'player_id, question_id, selected_x_ratio, selected_y_ratio, ' +
          'submitted_at, time_remaining_ratio, is_correct, score'
        )
        .order('submitted_at', { ascending: true }),

      db.from('leaderboard_snapshot')
        .select('question_id, player_id, rank, display_name, question_score, cumulative_score')
        .order('question_id', { ascending: true })
        .order('rank', { ascending: true }),
    ]);

    if (playersResult.error) throw new Error(`players query: ${playersResult.error.message}`);
    if (answersResult.error) throw new Error(`answers query: ${answersResult.error.message}`);
    if (leaderboardResult.error) throw new Error(`leaderboard query: ${leaderboardResult.error.message}`);

    const body: ExportResultsResponse = {
      exported_at: new Date().toISOString(),
      players: (playersResult.data ?? []) as unknown as ExportResultsResponse['players'],
      answers: (answersResult.data ?? []) as unknown as ExportResultsResponse['answers'],
      leaderboard: (leaderboardResult.data ?? []) as unknown as ExportResultsResponse['leaderboard'],
    };

    return Response.json(body, { headers: corsHeaders });

  } catch (e) {
    console.error('[export-results]', e);
    const body: ErrorResponse = { error: 'internal', detail: String(e) };
    return Response.json(body, { status: 500, headers: corsHeaders });
  }
});
