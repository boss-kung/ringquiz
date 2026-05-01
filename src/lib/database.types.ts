// Supabase-style generated database types.
// Used with createClient<Database> for type-safe queries.
// Regenerate with: npx supabase gen types typescript --linked > src/lib/database.types.ts
// This hand-crafted version matches the schema in 20260501000001_initial_schema.sql.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      game_state: {
        Row: {
          id: string;
          status: Database['public']['Enums']['game_status'];
          current_question_id: string | null;
          current_question_index: number | null;
          question_started_at: string | null;
          question_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status?: Database['public']['Enums']['game_status'];
          current_question_id?: string | null;
          current_question_index?: number | null;
          question_started_at?: string | null;
          question_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          status?: Database['public']['Enums']['game_status'];
          current_question_id?: string | null;
          current_question_index?: number | null;
          question_started_at?: string | null;
          question_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_game_state_current_question';
            columns: ['current_question_id'];
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };

      questions: {
        Row: {
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
        };
        Insert: {
          id?: string;
          order_index: number;
          text: string;
          image_url: string;
          circle_radius_ratio?: number;
          time_limit_seconds?: number;
          max_score?: number;
          min_correct_score?: number;
          image_width?: number | null;
          image_height?: number | null;
          reveal_image_url?: string | null;
          is_published?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_index?: number;
          text?: string;
          image_url?: string;
          circle_radius_ratio?: number;
          time_limit_seconds?: number;
          max_score?: number;
          min_correct_score?: number;
          image_width?: number | null;
          image_height?: number | null;
          reveal_image_url?: string | null;
          is_published?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };

      // question_masks is intentionally omitted from the client-side DB type.
      // It is inaccessible to all client roles (RLS: USING (false)).
      // Only Edge Functions read it via the service role client.

      players: {
        Row: {
          id: string;
          display_name: string;
          total_score: number;
          joined_at: string;
        };
        Insert: {
          id: string;         // must be auth.uid()
          display_name: string;
          total_score?: number;
          joined_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          total_score?: number; // client update blocked by intent; use service role RPC
          joined_at?: string;
        };
        Relationships: [];
      };

      answers: {
        Row: {
          id: string;
          player_id: string;
          question_id: string;
          selected_x_ratio: number;
          selected_y_ratio: number;
          submitted_at: string;
          time_remaining_ratio: number;
          is_correct: boolean;
          score: number;
        };
        // Insert is intentionally omitted — no client INSERT policy exists.
        // Inserts are performed by submit-answer Edge Function via service role.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'answers_player_id_fkey';
            columns: ['player_id'];
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'answers_question_id_fkey';
            columns: ['question_id'];
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
        ];
      };

      leaderboard_snapshot: {
        Row: {
          question_id: string;
          player_id: string;
          rank: number;
          display_name: string;
          question_score: number;
          cumulative_score: number;
        };
        // Insert and Update omitted — only service role writes via compute_leaderboard().
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'leaderboard_snapshot_question_id_fkey';
            columns: ['question_id'];
            referencedRelation: 'questions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leaderboard_snapshot_player_id_fkey';
            columns: ['player_id'];
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: Record<string, never>;

    Functions: {
      compute_leaderboard: {
        Args: { p_question_id: string };
        Returns: number;
      };
      increment_player_score: {
        Args: { p_player_id: string; p_amount: number };
        Returns: undefined;
      };
    };

    Enums: {
      game_status:
        | 'waiting'
        | 'countdown'
        | 'question_open'
        | 'question_closed'
        | 'reveal'
        | 'leaderboard'
        | 'ended';
    };

    CompositeTypes: Record<string, never>;
  };
};

// Convenience type aliases
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
