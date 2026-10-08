import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { getSupabaseAdmin } from '../_shared/supabase-admin.ts';
import { createTreasureRepository } from '../_shared/treasure-repository.ts';
import { handlePlayerAction, type PlayerActionRequest } from './handler.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return Response.json({ error: { code: 'method_not_allowed', message: 'POST required' } }, { status: 405, headers: corsHeaders });
  let body: PlayerActionRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: 'invalid_json', message: 'Invalid JSON' } }, { status: 400, headers: corsHeaders });
  }
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || body.accessToken;
  const { authUserId: _untrustedAuthUserId, ...safeBody } = body;
  return handlePlayerAction({ ...safeBody, accessToken: token }, {
    playerPin: Deno.env.get('PLAYER_PIN') ?? '',
    repository: createTreasureRepository(getSupabaseAdmin()),
  });
});
