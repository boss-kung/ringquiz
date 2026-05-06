-- Add special_round_type and special_round_label to game_set_questions.
-- Per-question in the game set, not in the base question bank, so the same
-- question can be used as a normal or double-score round in different game sets.
-- Existing rows default to 'normal' — no scoring change until host configures one.

alter table public.game_set_questions
  add column special_round_type text not null default 'normal'
    check (special_round_type in ('normal', 'double_score', 'speed_bonus', 'mystery_round')),
  add column special_round_label text null;
