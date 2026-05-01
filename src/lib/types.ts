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

export interface GameState {
  id: string;
  status: GameStatus;
  current_question_id: string | null;
  current_question_index: number | null;
  question_started_at: string | null;  // ISO 8601 UTC
  question_ends_at: string | null;     // ISO 8601 UTC — authoritative deadline
  updated_at: string;
  session_version: number;               // incremented on hard_reset_game to force player re-login
}

// ── Questions ────────────────────────────────────────────────────────────────
// Players receive these fields via RLS-filtered SELECT on the questions table.
// reveal_image_url is a safe optional overlay image (public bucket, NOT the mask).
// mask fields are never present in this type — they live in question_masks (private).

export interface Question {
  id: string;
  order_index: number;
  text: string;
  image_url: string;                   // public CDN URL
  circle_radius_ratio: number;         // [0, 0.5] fraction of image width
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number | null;
  image_height: number | null;
  reveal_image_url: string | null;     // null in V1; optional host-prepared overlay
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
  | 'recompute_leaderboard';

export interface HostActionRequest {
  action: HostActionName;
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
  question_index: number | null;
  total_questions: number;
  submitted_count: number;
  player_count: number;
  question_ends_at: string | null;
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
  selected_x_ratio: number;
  selected_y_ratio: number;
}
