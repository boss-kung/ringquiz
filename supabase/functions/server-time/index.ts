// server-time — returns current server timestamp in milliseconds.
// Auth: none. Called by all clients on mount to compute clock offset.
// Client usage: serverTimeOffset = server_time_ms - Date.now()
//   → visual timer: Date.now() + serverTimeOffset
//   → scoring: always uses server-side new Date() in Edge Functions, never client time.
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import type { ServerTimeResponse } from '../_shared/types.ts';

Deno.serve((req: Request): Response => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const body: ServerTimeResponse = { server_time_ms: Date.now() };
  return Response.json(body, { headers: corsHeaders });
});
