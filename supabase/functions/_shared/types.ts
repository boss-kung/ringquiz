// Shared domain types for Edge Functions.
// Keep in sync with src/lib/types.ts in the frontend.

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

export interface GameState {
  id: string;
  status: GameStatus;
  current_question_id: string | null;
  current_question_index: number | null;           // legacy: mirrors play_order when game-set aware
  question_started_at: string | null;              // ISO 8601
  question_ends_at: string | null;                 // ISO 8601
  updated_at: string;
  session_version: number;                         // incremented on hard_reset_game
  active_game_set_id: string | null;               // FK → game_sets.id
  current_game_set_question_id: string | null;     // FK → game_set_questions.id
  display_theme: DisplayTheme;                     // Big Screen theme, set by host
  current_special_rule_type: string;               // populated on countdown, reset on waiting
  current_special_rule_config: Record<string, unknown>;
}

export interface Question {
  id: string;
  order_index: number;
  text: string;
  image_url: string;
  circle_radius_ratio: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number | null;
  image_height: number | null;
  reveal_image_url: string | null;
  is_published: boolean;
  created_at: string;
}

export interface GameSetQuestion {
  id: string;
  game_set_id: string;
  question_id: string;
  play_order: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  circle_radius_ratio: number;
  is_enabled: boolean;
  special_rule_type: SpecialRuleType;
  special_rule_config: SpecialRuleConfig;
  created_at: string;
  updated_at: string;
}

export interface QuestionMask {
  id: string;
  question_id: string;
  mask_storage_path: string;
  mask_width: number | null;
  mask_height: number | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  display_name: string;
  total_score: number;
  joined_at: string;
}

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

export interface LeaderboardEntry {
  question_id: string;
  player_id: string;
  rank: number;
  display_name: string;
  question_score: number;
  cumulative_score: number;
}

// ── display-events ────────────────────────────────────────────────────────────

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

// ── host-action ──────────────────────────────────────────────────────────────

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

// ── submit-answer ────────────────────────────────────────────────────────────

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

// ── server-time ──────────────────────────────────────────────────────────────

export interface ServerTimeResponse {
  server_time_ms: number;
}

// ── get-reveal-zone ──────────────────────────────────────────────────────────

export interface RevealZoneResponse {
  x_ratio: number;
  y_ratio: number;
}

// ── get-question-stats ───────────────────────────────────────────────────────

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

export type SupabaseUsageStatus = 'ok' | 'warning' | 'danger' | 'unknown';
export type SupabaseUsageSource = 'live_project' | 'management_api' | 'estimate' | 'manual';

export interface SupabaseUsageMetric {
  key: string;
  label: string;
  used: number | null;
  limit: number | null;
  unit: 'bytes' | 'count' | 'requests' | 'connections' | 'messages' | 'invocations';
  percent: number | null;
  status: SupabaseUsageStatus;
  source: SupabaseUsageSource;
  note_th: string;
}

export interface SupabaseUsageResponse {
  generated_at: string;
  project_ref: string | null;
  plan: 'free';
  billing_window_note_th: string;
  management_api: {
    configured: boolean;
    ok: boolean;
    note_th: string;
  };
  metrics: SupabaseUsageMetric[];
  local_counts: {
    players: number;
    questions: number;
    answers: number;
    storage_objects: number;
  };
  warnings: string[];
}

// ── export-results ───────────────────────────────────────────────────────────

export interface ExportResultsResponse {
  exported_at: string;
  questions: Array<{
    id: string;
    order: number;
    time_limit_seconds: number;
  }>;
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
    special_rule_type?: SpecialRuleType | null;
    special_rule_config_snapshot?: SpecialRuleConfig | null;
    score_breakdown?: ScoreBreakdownItem[] | null;
    special_bonus_applied?: boolean;
  }>;
  leaderboard: LeaderboardEntry[];
}

// ── error responses ──────────────────────────────────────────────────────────

export interface ErrorResponse {
  error: string;
  detail?: string;
  field?: string;
  from?: GameStatus;
  action?: string;
}
