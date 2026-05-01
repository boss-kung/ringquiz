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

export interface GameState {
  id: string;
  status: GameStatus;
  current_question_id: string | null;
  current_question_index: number | null;
  question_started_at: string | null;  // ISO 8601
  question_ends_at: string | null;     // ISO 8601
  updated_at: string;
  session_version: number;               // incremented on hard_reset_game to force player re-login
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
}

export interface LeaderboardEntry {
  question_id: string;
  player_id: string;
  rank: number;
  display_name: string;
  question_score: number;
  cumulative_score: number;
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
  | 'recompute_leaderboard';

export interface HostActionRequest {
  action: HostActionName;
}

export interface HostActionResponse {
  ok: boolean;
  action: HostActionName;
  status: GameStatus;
  already_in_state: boolean;         // true when target state == current state (idempotent hit)
  question_id: string | null;
  question_index: number | null;
  question_started_at: string | null;
  question_ends_at: string | null;
  entries_written?: number;          // present for close_question, force_close, recompute
}

// ── submit-answer ────────────────────────────────────────────────────────────

export interface SubmitAnswerRequest {
  question_id: string;
  x_ratio: number;   // [0, 1] normalized position within question image
  y_ratio: number;   // [0, 1]
}

export interface SubmitAnswerResponse {
  is_correct: boolean;
  score: number;
  already_submitted: boolean;
  // Present when already_submitted is true — lets the client restore the circle position.
  selected_x_ratio?: number;
  selected_y_ratio?: number;
}

// ── server-time ──────────────────────────────────────────────────────────────

export interface ServerTimeResponse {
  server_time_ms: number;
}

// ── get-reveal-zone ──────────────────────────────────────────────────────────

export interface RevealZoneResponse {
  x_ratio: number;  // centroid X of correct-zone pixels, normalized [0, 1]
  y_ratio: number;  // centroid Y of correct-zone pixels, normalized [0, 1]
}

// ── get-question-stats ───────────────────────────────────────────────────────

export interface QuestionStatsResponse {
  status: GameStatus;
  question_id: string | null;
  question_index: number | null;
  total_questions: number;
  submitted_count: number;
  player_count: number;
  question_ends_at: string | null;
}

// ── export-results ───────────────────────────────────────────────────────────

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

// ── error responses ──────────────────────────────────────────────────────────

export interface ErrorResponse {
  error: string;
  detail?: string;
  field?: string;
  from?: GameStatus;
  action?: string;
}
