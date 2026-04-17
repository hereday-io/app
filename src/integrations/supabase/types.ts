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
      event_subscribers: {
        Row: {
          created_at: string
          email: string
          event_id: string
          id: number
          source: string | null
          unsubscribed_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          event_id: string
          id?: number
          source?: string | null
          unsubscribed_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string
          id?: number
          source?: string | null
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_subscribers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_subscribers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          branding_style: string
          city: string | null
          created_at: string
          event_date: string | null
          id: string
          logo_url: string | null
          name: string
          paid_at: string | null
          plan: string
          poi_count: number
          pois: Json
          route_count: number
          routes: Json
          scouted_pois: Json
          slug: string | null
          status: string
          stripe_payment_id: string | null
          stripe_session_id: string | null
          emergency_contacts: Json
          start_time: string | null
          tracking_end: string | null
          tracking_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          branding_style?: string
          city?: string | null
          created_at?: string
          emergency_contacts?: Json
          event_date?: string | null
          id?: string
          logo_url?: string | null
          name: string
          paid_at?: string | null
          plan?: string
          poi_count?: number
          pois?: Json
          route_count?: number
          routes?: Json
          scouted_pois?: Json
          slug?: string | null
          start_time?: string | null
          status?: string
          stripe_payment_id?: string | null
          stripe_session_id?: string | null
          tracking_end?: string | null
          tracking_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          branding_style?: string
          city?: string | null
          created_at?: string
          emergency_contacts?: Json
          event_date?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          paid_at?: string | null
          plan?: string
          poi_count?: number
          pois?: Json
          route_count?: number
          routes?: Json
          scouted_pois?: Json
          slug?: string | null
          start_time?: string | null
          status?: string
          stripe_payment_id?: string | null
          stripe_session_id?: string | null
          tracking_end?: string | null
          tracking_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      poi_volunteer_tokens: {
        Row: {
          created_at: string
          created_by: string
          event_id: string
          label: string | null
          purpose: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          event_id: string
          label?: string | null
          purpose: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string
          event_id?: string
          label?: string | null
          purpose?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "poi_volunteer_tokens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_volunteer_tokens_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
      }
      product_events: {
        Row: {
          created_at: string
          event_id: string | null
          event_type: string
          id: number
          properties: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          event_type: string
          id?: number
          properties?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          event_type?: string
          id?: number
          properties?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_period_end: string | null
          display_name: string | null
          id: string
          is_paid: boolean
          organization_name: string | null
          plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          id?: string
          is_paid?: boolean
          organization_name?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          id?: string
          is_paid?: boolean
          organization_name?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tracking_sessions: {
        Row: {
          color: string
          created_at: string
          event_id: string
          id: string
          is_active: boolean
          last_lat: number | null
          last_lng: number | null
          last_ping_at: string | null
          runner_name: string
          started_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          event_id: string
          id?: string
          is_active?: boolean
          last_lat?: number | null
          last_lng?: number | null
          last_ping_at?: string | null
          runner_name: string
          started_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          event_id?: string
          id?: string
          is_active?: boolean
          last_lat?: number | null
          last_lng?: number | null
          last_ping_at?: string | null
          runner_name?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_events: {
        Row: {
          branding_style: string | null
          city: string | null
          event_date: string | null
          has_ended: boolean | null
          id: string | null
          logo_url: string | null
          name: string | null
          owner_is_paid: boolean | null
          poi_count: number | null
          pois: Json | null
          route_count: number | null
          routes: Json | null
          slug: string | null
          tracking_end: string | null
          tracking_start: string | null
          updated_at: string | null
        }
        Insert: {
          branding_style?: string | null
          city?: string | null
          event_date?: string | null
          has_ended?: never
          id?: string | null
          logo_url?: string | null
          name?: string | null
          owner_is_paid?: never
          poi_count?: number | null
          pois?: Json | null
          route_count?: number | null
          routes?: Json | null
          slug?: string | null
          tracking_end?: string | null
          tracking_start?: string | null
          updated_at?: string | null
        }
        Update: {
          branding_style?: string | null
          city?: string | null
          event_date?: string | null
          has_ended?: never
          id?: string | null
          logo_url?: string | null
          name?: string | null
          owner_is_paid?: never
          poi_count?: number | null
          pois?: Json | null
          route_count?: number | null
          routes?: Json | null
          slug?: string | null
          tracking_end?: string | null
          tracking_start?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      event_owner_is_paid: { Args: { owner_id: string }; Returns: boolean }
      get_event_analytics: { Args: { p_event_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
