-- Add current_special_rule_type and current_special_rule_config to game_state so
-- the countdown screen can show the special-rule card immediately on receiving the
-- realtime event, without waiting for a separate question fetch.
-- Both columns reset to 'normal'/'{}'  when the host transitions back to waiting.

ALTER TABLE public.game_state
  ADD COLUMN current_special_rule_type text NOT NULL DEFAULT 'normal',
  ADD COLUMN current_special_rule_config jsonb NOT NULL DEFAULT '{}';
