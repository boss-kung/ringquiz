export type AdminQuestionActionName =
  | 'list_questions'
  | 'create_question'
  | 'update_question'
  | 'bulk_create_questions'
  | 'move_question'
  | 'publish_question'
  | 'unpublish_question'
  | 'delete_question';

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
}

export interface AdminQuestionResponse {
  ok: boolean;
  action: AdminQuestionActionName;
  questions?: AdminQuestionRecord[];
  question?: AdminQuestionRecord;
  created_count?: number;
  error?: string;
  detail?: string;
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
