-- Treasure Quiz MVP schema.
-- This migration is intentionally isolated from RingQuiz tables and functions.

create type public.tq_game_phase as enum (
  'waiting',
  'briefing',
  'playing',
  'round_result',
  'event',
  'prize_shop',
  'chest_opening',
  'finished',
  'cancelled'
);

create type public.tq_bet_type as enum ('safe', 'gold', 'diamond');
create type public.tq_question_type as enum ('true_false', 'multiple_choice', 'time_bank', 'no_mistake');
create type public.tq_redemption_status as enum ('pending', 'completed', 'cancelled');

create table public.tq_player_profile (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true check (singleton),
  auth_user_id uuid unique,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 40),
  balance_satang bigint not null default 0 check (balance_satang >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tq_player_profile_singleton unique (singleton)
);

create table public.tq_questions (
  id uuid primary key default gen_random_uuid(),
  round_no smallint not null check (round_no between 1 and 8),
  position smallint not null check (position between 1 and 10),
  question_type public.tq_question_type not null,
  prompt text not null check (char_length(prompt) between 1 and 500),
  keyword text not null check (char_length(keyword) between 1 and 80),
  choices jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  correct_answer text not null,
  difficulty smallint not null default 1 check (difficulty between 1 and 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tq_questions_round_position_unique unique (round_no, position)
);

create table public.tq_games (
  id uuid primary key default gen_random_uuid(),
  phase public.tq_game_phase not null default 'waiting',
  current_round smallint not null default 0 check (current_round between 0 and 8),
  player_profile_id uuid not null references public.tq_player_profile(id),
  gold integer not null default 200 check (gold >= 0),
  gems integer not null default 0 check (gems >= 0),
  config_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index tq_games_one_active_idx
  on public.tq_games ((true))
  where phase not in ('finished'::public.tq_game_phase, 'cancelled'::public.tq_game_phase);

create table public.tq_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tq_games(id) on delete cascade,
  round_no smallint not null check (round_no between 1 and 8),
  phase public.tq_game_phase not null default 'briefing',
  bet_type public.tq_bet_type not null default 'safe',
  stake_gold integer not null default 0 check (stake_gold >= 0),
  stake_gems integer not null default 0 check (stake_gems >= 0),
  started_at timestamptz,
  deadline timestamptz,
  correct_count smallint,
  answered_count smallint,
  base_reward_gold integer check (base_reward_gold is null or base_reward_gold >= 0),
  bonus_reward_gold integer check (bonus_reward_gold is null or bonus_reward_gold >= 0),
  achievement_gems integer check (achievement_gems is null or achievement_gems >= 0),
  active_effects jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tq_rounds_game_round_unique unique (game_id, round_no)
);

create table public.tq_answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tq_games(id) on delete cascade,
  round_no smallint not null check (round_no between 1 and 8),
  question_id uuid not null references public.tq_questions(id),
  answer jsonb not null,
  submitted_at timestamptz not null default now(),
  response_ms integer check (response_ms is null or response_ms >= 0),
  is_correct boolean not null,
  constraint tq_answers_game_round_question_unique unique (game_id, round_no, question_id)
);

create table public.tq_chest_types (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  gold_cost integer not null default 0 check (gold_cost >= 0),
  gem_cost integer not null default 0 check (gem_cost >= 0),
  reward_table jsonb not null check (jsonb_typeof(reward_table) = 'array'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.tq_chest_opens (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.tq_games(id) on delete cascade,
  player_profile_id uuid not null references public.tq_player_profile(id),
  chest_key text not null references public.tq_chest_types(key),
  purchase_index smallint not null check (purchase_index >= 1),
  gold_cost integer not null check (gold_cost >= 0),
  gem_cost integer not null check (gem_cost >= 0),
  status text not null default 'purchased' check (status in ('purchased', 'opened')),
  result_satang bigint check (result_satang is null or result_satang >= 0),
  opened_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint tq_chest_opens_game_purchase_unique unique (game_id, purchase_index)
);

create table public.tq_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  player_profile_id uuid not null references public.tq_player_profile(id),
  amount_satang bigint not null check (amount_satang <> 0),
  entry_type text not null check (entry_type in ('chest_reward', 'redemption', 'host_adjustment')),
  reference_id uuid,
  reason text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.tq_reward_catalog (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  reward_kind text not null check (reward_kind in ('cash', 'experience')),
  cost_satang bigint not null check (cost_satang > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tq_redemptions (
  id uuid primary key default gen_random_uuid(),
  player_profile_id uuid not null references public.tq_player_profile(id),
  reward_catalog_id uuid not null references public.tq_reward_catalog(id),
  cost_satang bigint not null check (cost_satang > 0),
  status public.tq_redemption_status not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index tq_rounds_game_idx on public.tq_rounds(game_id, round_no);
create index tq_answers_game_round_idx on public.tq_answers(game_id, round_no);
create index tq_chest_opens_profile_idx on public.tq_chest_opens(player_profile_id, game_id);
create index tq_wallet_entries_profile_idx on public.tq_wallet_entries(player_profile_id, created_at desc);
create index tq_redemptions_profile_idx on public.tq_redemptions(player_profile_id, created_at desc);

create or replace function public.tq_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tq_player_profile_updated_at before update on public.tq_player_profile
for each row execute function public.tq_touch_updated_at();
create trigger tq_questions_updated_at before update on public.tq_questions
for each row execute function public.tq_touch_updated_at();
create trigger tq_games_updated_at before update on public.tq_games
for each row execute function public.tq_touch_updated_at();
create trigger tq_rounds_updated_at before update on public.tq_rounds
for each row execute function public.tq_touch_updated_at();
create trigger tq_chest_types_updated_at before update on public.tq_chest_types
for each row execute function public.tq_touch_updated_at();
create trigger tq_reward_catalog_updated_at before update on public.tq_reward_catalog
for each row execute function public.tq_touch_updated_at();

insert into public.tq_player_profile (singleton, display_name)
values (true, 'Player')
on conflict (singleton) do nothing;

insert into public.tq_chest_types (key, name, gold_cost, gem_cost, reward_table)
values
  ('copper', 'หีบทองแดง', 100, 0, '[{"amount_satang":1,"weight":60},{"amount_satang":10,"weight":30},{"amount_satang":50,"weight":10}]'::jsonb),
  ('silver', 'หีบเงิน', 300, 0, '[{"amount_satang":50,"weight":55},{"amount_satang":100,"weight":35},{"amount_satang":200,"weight":10}]'::jsonb),
  ('gold', 'หีบทอง', 700, 1, '[{"amount_satang":100,"weight":50},{"amount_satang":200,"weight":30},{"amount_satang":500,"weight":18},{"amount_satang":1000,"weight":2}]'::jsonb),
  ('diamond', 'หีบเพชร', 1500, 3, '[{"amount_satang":500,"weight":50},{"amount_satang":1000,"weight":30},{"amount_satang":2000,"weight":17},{"amount_satang":5000,"weight":2},{"amount_satang":10000,"weight":1}]'::jsonb),
  ('crystal', 'หีบคริสตัลเล็ก', 0, 1, '[{"amount_satang":10,"weight":60},{"amount_satang":50,"weight":30},{"amount_satang":100,"weight":10}]'::jsonb),
  ('consolation', 'หีบปลอบใจ', 0, 0, '[{"amount_satang":1,"weight":100}]'::jsonb)
on conflict (key) do nothing;

insert into public.tq_reward_catalog (title, reward_kind, cost_satang)
select 'เงินสด 100 บาท', 'cash', 10000
where not exists (select 1 from public.tq_reward_catalog where title = 'เงินสด 100 บาท');

insert into public.tq_reward_catalog (title, reward_kind, cost_satang)
select 'บุฟเฟต์สุกี้', 'experience', 25000
where not exists (select 1 from public.tq_reward_catalog where title = 'บุฟเฟต์สุกี้');

alter table public.tq_player_profile enable row level security;
alter table public.tq_questions enable row level security;
alter table public.tq_games enable row level security;
alter table public.tq_rounds enable row level security;
alter table public.tq_answers enable row level security;
alter table public.tq_chest_types enable row level security;
alter table public.tq_chest_opens enable row level security;
alter table public.tq_wallet_entries enable row level security;
alter table public.tq_reward_catalog enable row level security;
alter table public.tq_redemptions enable row level security;

create or replace function public.tq_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.tq_player_profile where auth_user_id = auth.uid() limit 1;
$$;

revoke all on function public.tq_current_profile_id() from public;
grant execute on function public.tq_current_profile_id() to anon, authenticated;

create policy tq_profile_select_own on public.tq_player_profile
for select to authenticated using (auth.uid() = auth_user_id);

create policy tq_games_select_own on public.tq_games
for select to authenticated using (player_profile_id = public.tq_current_profile_id());

create policy tq_rounds_select_own on public.tq_rounds
for select to authenticated using (
  exists (
    select 1 from public.tq_games g
    where g.id = tq_rounds.game_id
      and g.player_profile_id = public.tq_current_profile_id()
  )
);

create policy tq_chest_opens_select_own on public.tq_chest_opens
for select to authenticated using (player_profile_id = public.tq_current_profile_id());

create policy tq_wallet_entries_select_own on public.tq_wallet_entries
for select to authenticated using (player_profile_id = public.tq_current_profile_id());

create policy tq_reward_catalog_select_active on public.tq_reward_catalog
for select to authenticated using (active);

create policy tq_redemptions_select_own on public.tq_redemptions
for select to authenticated using (player_profile_id = public.tq_current_profile_id());

-- Questions, answers, chest types and all mutations are Edge Function/service-role only.
grant select on public.tq_player_profile, public.tq_games, public.tq_rounds,
  public.tq_chest_opens, public.tq_wallet_entries, public.tq_reward_catalog,
  public.tq_redemptions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tq_games'
  ) then alter publication supabase_realtime add table public.tq_games; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tq_rounds'
  ) then alter publication supabase_realtime add table public.tq_rounds; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tq_chest_opens'
  ) then alter publication supabase_realtime add table public.tq_chest_opens; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tq_redemptions'
  ) then alter publication supabase_realtime add table public.tq_redemptions; end if;
end;
$$;
