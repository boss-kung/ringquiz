// ── Question Bank types ──────────────────────────────────────────────────────

export type AdminQuestionActionName =
  | 'list_questions'
  | 'create_question'
  | 'update_question'
  | 'bulk_create_questions'
  | 'move_question'
  | 'publish_question'
  | 'unpublish_question'
  | 'delete_question'
  // Game set management
  | 'list_game_sets'
  | 'create_game_set'
  | 'update_game_set_name'
  | 'delete_game_set'
  | 'set_active_game_set'
  | 'list_game_set_questions'
  | 'add_question_to_game_set'
  | 'bulk_add_questions_to_game_set'
  | 'remove_game_set_question'
  | 'update_game_set_question'
  | 'reorder_game_set_questions'
  | 'toggle_game_set_question_enabled';

export interface AdminQuestionRecord {
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
  mask_storage_path: string;
  mask_width: number | null;
  mask_height: number | null;
}

export interface AdminQuestionPayload {
  text: string;
  image_url: string;
  mask_storage_path: string;
  circle_radius_ratio: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  image_width: number;
  image_height: number;
  mask_width: number;
  mask_height: number;
  order_index?: number;
  is_published?: boolean;
  reveal_image_url?: string | null;
}

export interface AdminQuestionRequest {
  action: AdminQuestionActionName;
  question_id?: string;
  direction?: 'up' | 'down';
  question?: AdminQuestionPayload;
  questions?: AdminQuestionPayload[];
  // Game set fields
  game_set_id?: string;
  game_set_question_id?: string;
  question_ids?: string[];
  name?: string;
  play_order?: number;
  time_limit_seconds?: number;
  max_score?: number;
  min_correct_score?: number;
  circle_radius_ratio?: number;
  is_enabled?: boolean;
  ordered_ids?: string[];              // for reorder_game_set_questions
}

export interface AdminQuestionResponse {
  ok: boolean;
  action: AdminQuestionActionName;
  questions?: AdminQuestionRecord[];
  question?: AdminQuestionRecord;
  created_count?: number;
  error?: string;
  detail?: string;
  // Game set fields
  game_sets?: GameSetRecord[];
  game_set?: GameSetRecord;
  game_set_questions?: GameSetQuestionRecord[];
  game_set_question?: GameSetQuestionRecord;
}

export interface AdminUploadAssetsResponse {
  ok: boolean;
  action: 'upload_assets';
  image_url: string;
  mask_storage_path: string;
  reveal_image_url: string | null;
  image_width: number;
  image_height: number;
  mask_width: number;
  mask_height: number;
}

export interface AdminQuestionValidationIssue {
  field: string;
  message: string;
}

export interface AdminQuestionPreviewItem {
  index: number;
  input: unknown;
  valid: boolean;
  normalizedQuestion?: AdminQuestionPayload;
  errors: AdminQuestionValidationIssue[];
}

// ── Game Set types ───────────────────────────────────────────────────────────

export interface GameSetRecord {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at: string;
  question_count: number;
  enabled_question_count: number;
}

export interface GameSetQuestionRecord {
  id: string;
  game_set_id: string;
  question_id: string;
  play_order: number;
  time_limit_seconds: number;
  max_score: number;
  min_correct_score: number;
  circle_radius_ratio: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Joined question data (populated by list_game_set_questions)
  question_text: string;
  question_image_url: string;
  question_reveal_image_url: string | null;
  question_image_width: number | null;
  question_image_height: number | null;
}
