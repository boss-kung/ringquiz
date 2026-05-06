-- Add display_theme to game_state so the chosen theme persists through
-- Display page reloads. Host updates via set_display_theme action.
-- Soft/hard reset does NOT reset the theme — it is a presentation concern.

alter table public.game_state
  add column display_theme text not null default 'classic_gold'
  check (display_theme in ('classic_gold', 'neon_night', 'danger_round', 'final_round'));
