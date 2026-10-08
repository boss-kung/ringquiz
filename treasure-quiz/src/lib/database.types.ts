export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      tq_player_profile: {
        Row: { id: string; singleton: boolean; auth_user_id: string | null; display_name: string; balance_satang: number; created_at: string; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_player_profile']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_player_profile']['Row']>;
      };
      tq_questions: {
        Row: { id: string; round_no: number; position: number; question_type: Database['public']['Enums']['tq_question_type']; prompt: string; keyword: string; choices: Json; correct_answer: string; difficulty: number; active: boolean; created_at: string; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_questions']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_questions']['Row']>;
      };
      tq_games: {
        Row: { id: string; phase: Database['public']['Enums']['tq_game_phase']; current_round: number; player_profile_id: string; gold: number; gems: number; config_snapshot: Json; created_at: string; started_at: string | null; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_games']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_games']['Row']>;
      };
      tq_rounds: {
        Row: { id: string; game_id: string; round_no: number; phase: Database['public']['Enums']['tq_game_phase']; bet_type: Database['public']['Enums']['tq_bet_type']; stake_gold: number; stake_gems: number; started_at: string | null; deadline: string | null; correct_count: number | null; answered_count: number | null; base_reward_gold: number | null; bonus_reward_gold: number | null; achievement_gems: number | null; active_effects: Json; created_at: string; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_rounds']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_rounds']['Row']>;
      };
      tq_answers: {
        Row: { id: string; game_id: string; round_no: number; question_id: string; answer: Json; submitted_at: string; response_ms: number | null; is_correct: boolean };
        Insert: Partial<Database['public']['Tables']['tq_answers']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_answers']['Row']>;
      };
      tq_chest_types: {
        Row: { key: string; name: string; gold_cost: number; gem_cost: number; reward_table: Json; enabled: boolean; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_chest_types']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_chest_types']['Row']>;
      };
      tq_chest_opens: {
        Row: { id: string; game_id: string; player_profile_id: string; chest_key: string; purchase_index: number; gold_cost: number; gem_cost: number; status: string; result_satang: number | null; opened_at: string | null; idempotency_key: string; created_at: string };
        Insert: Partial<Database['public']['Tables']['tq_chest_opens']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_chest_opens']['Row']>;
      };
      tq_wallet_entries: {
        Row: { id: string; player_profile_id: string; amount_satang: number; entry_type: string; reference_id: string | null; reason: string | null; idempotency_key: string; created_at: string };
        Insert: Partial<Database['public']['Tables']['tq_wallet_entries']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_wallet_entries']['Row']>;
      };
      tq_reward_catalog: {
        Row: { id: string; title: string; reward_kind: string; cost_satang: number; active: boolean; created_at: string; updated_at: string };
        Insert: Partial<Database['public']['Tables']['tq_reward_catalog']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_reward_catalog']['Row']>;
      };
      tq_redemptions: {
        Row: { id: string; player_profile_id: string; reward_catalog_id: string; cost_satang: number; status: Database['public']['Enums']['tq_redemption_status']; created_at: string; completed_at: string | null };
        Insert: Partial<Database['public']['Tables']['tq_redemptions']['Row']>;
        Update: Partial<Database['public']['Tables']['tq_redemptions']['Row']>;
      };
    };
    Enums: {
      tq_game_phase: 'waiting' | 'briefing' | 'playing' | 'round_result' | 'event' | 'prize_shop' | 'chest_opening' | 'finished' | 'cancelled';
      tq_bet_type: 'safe' | 'gold' | 'diamond';
      tq_question_type: 'true_false' | 'multiple_choice' | 'time_bank' | 'no_mistake';
      tq_redemption_status: 'pending' | 'completed' | 'cancelled';
    };
  };
};
