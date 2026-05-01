// Service role Supabase client for Edge Functions.
// This client bypasses RLS — use only for privileged operations.
// Never expose the service role key to the browser.
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return _admin;
}
