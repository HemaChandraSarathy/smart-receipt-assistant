export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_checkpoints: {
        Row: {
          checkpoint_id: string
          created_at: string
          parent_id: string | null
          payload: Json
          thread_id: string
          user_id: string
        }
        Insert: {
          checkpoint_id: string
          created_at?: string
          parent_id?: string | null
          payload: Json
          thread_id: string
          user_id: string
        }
        Update: {
          checkpoint_id?: string
          created_at?: string
          parent_id?: string | null
          payload?: Json
          thread_id?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_events: {
        Row: {
          id: string
          kind: string
          node: string
          payload: Json
          run_id: string
          ts: string
          user_id: string
        }
        Insert: {
          id?: string
          kind: string
          node: string
          payload?: Json
          run_id: string
          ts?: string
          user_id: string
        }
        Update: {
          id?: string
          kind?: string
          node?: string
          payload?: Json
          run_id?: string
          ts?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          created_at: string
          current_node: string | null
          ended_at: string | null
          error: string | null
          id: string
          input_kind: string
          input_ref: Json
          langsmith_url: string | null
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_node?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          input_kind: string
          input_ref?: Json
          langsmith_url?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_node?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          input_kind?: string
          input_ref?: Json
          langsmith_url?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          action_kind: string
          created_at: string
          decided_at: string | null
          decision: Json | null
          id: string
          node: string
          proposal: Json
          run_id: string
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          action_kind: string
          created_at?: string
          decided_at?: string | null
          decision?: Json | null
          id?: string
          node: string
          proposal: Json
          run_id: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          action_kind?: string
          created_at?: string
          decided_at?: string | null
          decision?: Json | null
          id?: string
          node?: string
          proposal?: Json
          run_id?: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_rules: {
        Row: {
          created_at: string
          id: string
          keywords: string[]
          owner: Database["public"]["Enums"]["assignee"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          keywords?: string[]
          owner: Database["public"]["Enums"]["assignee"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          keywords?: string[]
          owner?: Database["public"]["Enums"]["assignee"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      followups: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          id: string
          item_id: string
          last_run_at: string | null
          next_nudge_at: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          id?: string
          item_id: string
          last_run_at?: string | null
          next_nudge_at: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          id?: string
          item_id?: string
          last_run_at?: string | null
          next_nudge_at?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          amount: number | null
          archived: boolean
          assignee: Database["public"]["Enums"]["assignee"]
          category: Database["public"]["Enums"]["item_category"]
          created_at: string
          currency: string | null
          description: string | null
          due_at: string | null
          embedding: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          merchant: string | null
          raw: Json | null
          rsvp_by: string | null
          run_id: string | null
          source: string
          source_ref: Json | null
          title: string
          topic: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          archived?: boolean
          assignee?: Database["public"]["Enums"]["assignee"]
          category?: Database["public"]["Enums"]["item_category"]
          created_at?: string
          currency?: string | null
          description?: string | null
          due_at?: string | null
          embedding?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          merchant?: string | null
          raw?: Json | null
          rsvp_by?: string | null
          run_id?: string | null
          source: string
          source_ref?: Json | null
          title: string
          topic?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          archived?: boolean
          assignee?: Database["public"]["Enums"]["assignee"]
          category?: Database["public"]["Enums"]["item_category"]
          created_at?: string
          currency?: string | null
          description?: string | null
          due_at?: string | null
          embedding?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          merchant?: string | null
          raw?: Json | null
          rsvp_by?: string | null
          run_id?: string | null
          source?: string
          source_ref?: Json | null
          title?: string
          topic?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_items: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          amount: number
          assignee: Database["public"]["Enums"]["assignee"]
          category: Database["public"]["Enums"]["item_category"]
          due_at: string
          expires_at: string
          id: string
          merchant: string
          similarity: number
          title: string
          topic: string
        }[]
      }
    }
    Enums: {
      approval_status: "pending" | "approved" | "edited" | "rejected"
      assignee: "mom" | "dad" | "either"
      item_category:
        | "bill"
        | "promo"
        | "coupon"
        | "invite"
        | "receipt"
        | "other"
      run_status:
        | "running"
        | "awaiting_approval"
        | "done"
        | "failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_status: ["pending", "approved", "edited", "rejected"],
      assignee: ["mom", "dad", "either"],
      item_category: ["bill", "promo", "coupon", "invite", "receipt", "other"],
      run_status: [
        "running",
        "awaiting_approval",
        "done",
        "failed",
        "cancelled",
      ],
    },
  },
} as const
