-- Host-only usage helper for the Supabase Free usage panel.
-- Called by the supabase-usage Edge Function through the service-role client.

create or replace function public.host_project_usage_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'players', (select count(*) from public.players),
    'questions', (select count(*) from public.questions),
    'answers', (select count(*) from public.answers),
    'game_sets', (select count(*) from public.game_sets),
    'leaderboard_rows', (select count(*) from public.leaderboard_snapshot)
  );
$$;

revoke all on function public.host_project_usage_snapshot() from public;
grant execute on function public.host_project_usage_snapshot() to service_role;
