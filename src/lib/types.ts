// Domain types for the frontend.
// Keep in sync with supabase/functions/_shared/types.ts.
// Use these types everywhere: hooks, store, components, API calls.

// ── Game state ───────────────────────────────────────────────────────────────

export type GameStatus =
  | 'waiting'
  | 'countdown'
  | 'question_open'
  | 'question_closed'
  | 'reveal'
  | 'leaderboard'
  | 'ended';

export type DisplayTheme = 'classic_gold' | 'neon_night' | 'danger_round' | 'final_round';

export type SpecialRuleType =
  | 'normal'
  | 'double_score'
  | 'triple_score'
  | 'speed_bonus'
  | 'no_mistake'
  | 'fastest_finger'
  | 'mystery_multiplier';

export interface SpecialRuleConfig {
  multiplier?: number;
  bonus_ratio?: number;
  max_bonus_points?: number;
  wrong_penalty_points?: number;
  penalize_no_answer?: boolean;
  allow_negative_total_score?: boolean;
  top_n?: number;
  bonus_points?: number;
  hidden_until_reveal?: boolean;
}

export interface ScoreBreakdownItem {
  type: 'base' | 'multiplier' | 'speed_bonus' | 'penalty' | 'fastest_finger' | 'final' | 'clamp';
  label: string;
  value: number;
  operation?: string;
}

export interface FastestFingerWinner {
  rank: number;
  player_id: string;
  display_name: string;
  bonus_points: number;
}

export interface PracticeContent {
  key: string;
  title: string;
  prompt: string;
  instruction: string;
  image_url: string;
  mask_url: string;
  reveal_image_url: string | null;
  circle_radius_ratio: number;
  image_width: number;
  image_height: number;
  mask_width: number;
  mask_height: number;
  created_at?: string;
  updated_at?: string;
}

export type DisplayEventType =
  | 'hype_cheer'
  | 'spotlight_leaderboard'
  | 'final_drumroll'
  | 'theme_change';

export interface DisplayEvent {
  id: string;
  event_type: DisplayEventType;
  payload: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface GameState {
  id: string;
  status: GameStatus;
  current_question_id: string | null;
  current_question_index: number | null;
  question_started_at: string | null;              // ISO 8601 UTC
  question_ends_at: string | null;                 // ISO 8601 UTC — authoritative deadline
  updated_at: string;
  session_version: number;                         // incremented on hard_reset_game
  active_game_set_id: string | null;               // FK → game_sets.id
  current_game_set_question_id: string | null;     // FK → game_set_questions.id
  display_theme: DisplayTheme;                     // Big Screen theme, persists through reload
  current_special_rule_type: SpecialRuleType;      // set on countdown, reset on waiting
  current_special_rule_config: SpecialRuleConfig;
}

// ── Questions ────────────────────────────────────────────────────────────────
// Players receive these fields via RLS-filtered SELECT on the questions table.
// reveal_image_url is a safe optional overlay image (public bucket, NOT the mask).
// mask fields are never present in this type — they live in question_masks (private).

export interface Question {
  id: string;
  order_index: number;
  play_order: number;
  text: string;
  image_url: string;                   // public CDN URL
  circle_radius_ratio: number;         // [0, 0.5] fraction of image width
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number | null;
  image_height: number | null;
  reveal_image_url: string | null;     // null in V1; optional host-prepared overlay
  special_rule_type?: SpecialRuleType;
  special_rule_config?: SpecialRuleConfig;
  is_published: boolean;
  created_at: string;
}

// ── Players ──────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  display_name: string;
  total_score: number;
  joined_at: string;
}

// ── Answers ──────────────────────────────────────────────────────────────────
// A player can only read their own answer row (RLS: player_id = auth.uid()).
// is_correct and score are set server-side — never trust client-provided values.

export interface Answer {
  id: string;
  player_id: string;
  question_id: string;
  selected_x_ratio: number;
  selected_y_ratio: number;
  submitted_at: string;
  time_remaining_ratio: number;
  is_correct: boolean;
  score: number;
  special_rule_type: SpecialRuleType | null;
  special_rule_config_snapshot: SpecialRuleConfig | null;
  score_breakdown: ScoreBreakdownItem[] | null;
  special_bonus_applied: boolean;
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  question_id: string;
  player_id: string;
  rank: number;
  display_name: string;
  question_score: number;
  cumulative_score: number;
}

// ── Edge Function request / response types ───────────────────────────────────

export type HostActionName =
  | 'start_countdown'
  | 'open_question'
  | 'close_question'
  | 'show_reveal'
  | 'show_leaderboard'
  | 'next_question'
  | 'end_game'
  | 'soft_reset_game'
  | 'hard_reset_game'
  | 'force_close_question'
  | 'recompute_leaderboard'
  | 'trigger_hype_cheer'
  | 'trigger_spotlight_leaderboard'
  | 'trigger_final_drumroll'
  | 'set_display_theme';

export interface HostActionRequest {
  action: HostActionName;
  payload?: Record<string, unknown>;
}

export interface HostActionResponse {
  ok: boolean;
  action: HostActionName;
  status: GameStatus;
  already_in_state: boolean;
  question_id: string | null;
  question_index: number | null;
  question_started_at: string | null;
  question_ends_at: string | null;
  entries_written?: number;
}

export interface SubmitAnswerRequest {
  question_id: string;
  x_ratio: number;
  y_ratio: number;
}

export interface SubmitAnswerResponse {
  is_correct: boolean;
  score: number;
  already_submitted: boolean;
  selected_x_ratio?: number;
  selected_y_ratio?: number;
  special_rule_type?: SpecialRuleType | null;
  special_rule_config_snapshot?: SpecialRuleConfig | null;
  score_breakdown?: ScoreBreakdownItem[] | null;
  special_bonus_applied?: boolean;
}

export interface ServerTimeResponse {
  server_time_ms: number;
}

export interface RevealZoneResponse {
  x_ratio: number;
  y_ratio: number;
}

export interface QuestionStatsResponse {
  status: GameStatus;
  question_id: string | null;
  question_index: number | null;       // 1-based position in active game set
  total_questions: number;             // total enabled questions in active game set
  submitted_count: number;
  player_count: number;
  question_ends_at: string | null;
  active_game_set_id: string | null;
  active_game_set_name: string | null;
}

export interface ExportResultsResponse {
  exported_at: string;
  players: Array<{
    id: string;
    display_name: string;
    total_score: number;
    joined_at: string;
  }>;
  answers: Array<{
    player_id: string;
    question_id: string;
    selected_x_ratio: number;
    selected_y_ratio: number;
    submitted_at: string;
    time_remaining_ratio: number;
    is_correct: boolean;
    score: number;
  }>;
  leaderboard: LeaderboardEntry[];
}

export interface DisplayStatsResponse {
  player_count: number;
  submitted_count: number;
  correct_count: number;
  accuracy: number;             // correct_count / submitted_count * 100, or 0
  question_index: number | null; // play_order in active game set
  total_questions: number;
  current_question_id: string | null;
  active_game_set_id: string | null;
  fastest_finger_winners?: FastestFingerWinner[];
}

export interface EdgeFunctionError {
  error: string;
  detail?: string;
  field?: string;
  from?: GameStatus;
  action?: string;
}

// ── UI-only types (not stored in DB) ─────────────────────────────────────────

// Player's in-progress circle position before submission
export interface CirclePosition {
  xRatio: number;
  yRatio: number;
}

// Result shown during the reveal state (player reads own answer row)
export interface RevealResult {
  is_correct: boolean;
  score: number;
  selected_x_ratio: number | null;
  selected_y_ratio: number | null;
  special_rule_type?: SpecialRuleType | null;
  special_rule_config_snapshot?: SpecialRuleConfig | null;
  score_breakdown?: ScoreBreakdownItem[] | null;
  special_bonus_applied?: boolean;
}
