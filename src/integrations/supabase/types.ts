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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      comp_grants: {
        Row: {
          grant_reason: string
          granted_at: string
          granted_by: string
          id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          grant_reason: string
          granted_at?: string
          granted_by: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          grant_reason?: string
          granted_at?: string
          granted_by?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      crm_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          dnc_at: string | null
          dnc_by: string | null
          dnc_reason: string | null
          do_not_contact: boolean
          id: string
          name: string
          notes: string | null
          org_description: string | null
          org_type: string | null
          town: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dnc_at?: string | null
          dnc_by?: string | null
          dnc_reason?: string | null
          do_not_contact?: boolean
          id?: string
          name: string
          notes?: string | null
          org_description?: string | null
          org_type?: string | null
          town?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dnc_at?: string | null
          dnc_by?: string | null
          dnc_reason?: string | null
          do_not_contact?: boolean
          id?: string
          name?: string
          notes?: string | null
          org_description?: string | null
          org_type?: string | null
          town?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      crm_activities: {
        Row: {
          account_id: string | null
          actor_id: string | null
          body: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          meta: Json
          occurred_at: string
          quote: string | null
          type: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          meta?: Json
          occurred_at?: string
          quote?: string | null
          type: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          body?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          meta?: Json
          occurred_at?: string
          quote?: string | null
          type?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          dnc_at: string | null
          dnc_by: string | null
          dnc_reason: string | null
          do_not_contact: boolean
          email: string | null
          email_source: string | null
          full_name: string | null
          id: string
          notes: string | null
          phone: string | null
          phone_source: string | null
          role_title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          dnc_at?: string | null
          dnc_by?: string | null
          dnc_reason?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_source?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          phone_source?: string | null
          role_title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          dnc_at?: string | null
          dnc_by?: string | null
          dnc_reason?: string | null
          do_not_contact?: boolean
          email?: string | null
          email_source?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          phone?: string | null
          phone_source?: string | null
          role_title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals: {
        Row: {
          account_id: string | null
          channel: string | null
          claimed_at: string | null
          closed_at: string | null
          course_map_url: string | null
          created_at: string
          created_by: string | null
          date_verified: boolean
          fit_flags: string[]
          followed_up_at: string | null
          gmail_draft_id: string | null
          gmail_draft_mailbox: string | null
          gmail_thread_id: string | null
          hereday_link: string | null
          id: string
          map_type: string | null
          next_step: string | null
          next_step_at: string | null
          notes: string | null
          objection: string | null
          outcome: string | null
          owner_id: string | null
          previous_deal_id: string | null
          primary_contact_id: string | null
          priority: number | null
          race_date: string | null
          race_name: string
          sent_at: string | null
          slug: string
          source: string
          stage: string
          stage_changed_at: string
          tier: number | null
          town: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          channel?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          course_map_url?: string | null
          created_at?: string
          created_by?: string | null
          date_verified?: boolean
          fit_flags?: string[]
          followed_up_at?: string | null
          gmail_draft_id?: string | null
          gmail_draft_mailbox?: string | null
          gmail_thread_id?: string | null
          hereday_link?: string | null
          id?: string
          map_type?: string | null
          next_step?: string | null
          next_step_at?: string | null
          notes?: string | null
          objection?: string | null
          outcome?: string | null
          owner_id?: string | null
          previous_deal_id?: string | null
          primary_contact_id?: string | null
          priority?: number | null
          race_date?: string | null
          race_name: string
          sent_at?: string | null
          slug: string
          source: string
          stage?: string
          stage_changed_at?: string
          tier?: number | null
          town?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          channel?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          course_map_url?: string | null
          created_at?: string
          created_by?: string | null
          date_verified?: boolean
          fit_flags?: string[]
          followed_up_at?: string | null
          gmail_draft_id?: string | null
          gmail_draft_mailbox?: string | null
          gmail_thread_id?: string | null
          hereday_link?: string | null
          id?: string
          map_type?: string | null
          next_step?: string | null
          next_step_at?: string | null
          notes?: string | null
          objection?: string | null
          outcome?: string | null
          owner_id?: string | null
          previous_deal_id?: string | null
          primary_contact_id?: string | null
          priority?: number | null
          race_date?: string | null
          race_name?: string
          sent_at?: string | null
          slug?: string
          source?: string
          stage?: string
          stage_changed_at?: string
          tier?: number | null
          town?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "crm_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_previous_deal_id_fkey"
            columns: ["previous_deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_event_links: {
        Row: {
          deal_id: string | null
          disposition: string
          event_id: string
          link_source: string
          linked_at: string
          linked_by: string | null
          reason: string | null
        }
        Insert: {
          deal_id?: string | null
          disposition: string
          event_id: string
          link_source: string
          linked_at?: string
          linked_by?: string | null
          reason?: string | null
        }
        Update: {
          deal_id?: string | null
          disposition?: string
          event_id?: string
          link_source?: string
          linked_at?: string
          linked_by?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_event_links_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          audiences: string[]
          body_preview: string
          event_id: string
          id: number
          recipient_count: number
          resend_batch_id: string | null
          sent_at: string
          sent_by_user_id: string
          subject: string
        }
        Insert: {
          audiences?: string[]
          body_preview: string
          event_id: string
          id?: number
          recipient_count?: number
          resend_batch_id?: string | null
          sent_at?: string
          sent_by_user_id: string
          subject: string
        }
        Update: {
          audiences?: string[]
          body_preview?: string
          event_id?: string
          id?: number
          recipient_count?: number
          resend_batch_id?: string | null
          sent_at?: string
          sent_by_user_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
      }
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
      event_transfers: {
        Row: {
          event_id: string
          event_name: string
          event_slug: string | null
          from_email: string | null
          from_user_id: string | null
          id: string
          note: string | null
          pro_source: string
          to_email: string
          to_user_id: string | null
          transferred_at: string
          transferred_by: string | null
        }
        Insert: {
          event_id: string
          event_name: string
          event_slug?: string | null
          from_email?: string | null
          from_user_id?: string | null
          id?: string
          note?: string | null
          pro_source: string
          to_email: string
          to_user_id?: string | null
          transferred_at?: string
          transferred_by?: string | null
        }
        Update: {
          event_id?: string
          event_name?: string
          event_slug?: string | null
          from_email?: string | null
          from_user_id?: string | null
          id?: string
          note?: string | null
          pro_source?: string
          to_email?: string
          to_user_id?: string | null
          transferred_at?: string
          transferred_by?: string | null
        }
        Relationships: []
      }
      events: {
        Row: {
          branding_style: string
          city: string | null
          comp_grant_id: string | null
          created_at: string
          emergency_contacts: Json | null
          event_date: string | null
          id: string
          logo_url: string | null
          name: string
          paid_at: string | null
          plan: string
          poi_count: number
          pois: Json
          registration_url: string | null
          route_count: number
          routes: Json
          scouted_pois: Json
          slug: string | null
          start_time: string | null
          status: string
          stripe_payment_id: string | null
          stripe_session_id: string | null
          tracking_end: string | null
          tracking_start: string | null
          updated_at: string
          user_id: string
          volunteer_active_minutes: number
          volunteer_idle_hours: number
          volunteer_roster: Json
        }
        Insert: {
          branding_style?: string
          city?: string | null
          comp_grant_id?: string | null
          created_at?: string
          emergency_contacts?: Json | null
          event_date?: string | null
          id?: string
          logo_url?: string | null
          name: string
          paid_at?: string | null
          plan?: string
          poi_count?: number
          pois?: Json
          registration_url?: string | null
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
          volunteer_active_minutes?: number
          volunteer_idle_hours?: number
          volunteer_roster?: Json
        }
        Update: {
          branding_style?: string
          city?: string | null
          comp_grant_id?: string | null
          created_at?: string
          emergency_contacts?: Json | null
          event_date?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          paid_at?: string | null
          plan?: string
          poi_count?: number
          pois?: Json
          registration_url?: string | null
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
          volunteer_active_minutes?: number
          volunteer_idle_hours?: number
          volunteer_roster?: Json
        }
        Relationships: [
          {
            foreignKeyName: "events_comp_grant_id_fkey"
            columns: ["comp_grant_id"]
            isOneToOne: false
            referencedRelation: "comp_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_status_history: {
        Row: {
          created_at: string
          event_id: string
          id: number
          moved_to_lat: number | null
          moved_to_lng: number | null
          note: string | null
          poi_id: string
          state: string
          updated_by_name: string | null
          updated_ip: unknown
          updated_via_token: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: number
          moved_to_lat?: number | null
          moved_to_lng?: number | null
          note?: string | null
          poi_id: string
          state: string
          updated_by_name?: string | null
          updated_ip?: unknown
          updated_via_token?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: number
          moved_to_lat?: number | null
          moved_to_lng?: number | null
          note?: string | null
          poi_id?: string
          state?: string
          updated_by_name?: string | null
          updated_ip?: unknown
          updated_via_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_status_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_status_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
      }
      poi_statuses: {
        Row: {
          event_id: string
          moved_to_lat: number | null
          moved_to_lng: number | null
          note: string | null
          poi_id: string
          state: string
          updated_at: string
          updated_by_name: string | null
          updated_via_token: string | null
        }
        Insert: {
          event_id: string
          moved_to_lat?: number | null
          moved_to_lng?: number | null
          note?: string | null
          poi_id: string
          state: string
          updated_at?: string
          updated_by_name?: string | null
          updated_via_token?: string | null
        }
        Update: {
          event_id?: string
          moved_to_lat?: number | null
          moved_to_lng?: number | null
          note?: string | null
          poi_id?: string
          state?: string
          updated_at?: string
          updated_by_name?: string | null
          updated_via_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poi_statuses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poi_statuses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "public_events"
            referencedColumns: ["id"]
          },
        ]
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
      pro_waitlist: {
        Row: {
          created_at: string
          email: string
          event_id: string | null
          id: number
          trigger: string | null
        }
        Insert: {
          created_at?: string
          email: string
          event_id?: string | null
          id?: number
          trigger?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          event_id?: string | null
          id?: number
          trigger?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pro_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pro_waitlist_event_id_fkey"
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
          active_promo_code: string | null
          active_promo_expires_at: string | null
          active_promo_percent_off: number | null
          active_promotion_code_id: string | null
          attribution_captured_at: string | null
          avatar_url: string | null
          created_at: string
          current_period_end: string | null
          display_name: string | null
          first_landing_page: string | null
          first_referrer: string | null
          id: string
          is_admin: boolean
          is_paid: boolean
          is_sales: boolean
          organization_name: string | null
          plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          active_promo_code?: string | null
          active_promo_expires_at?: string | null
          active_promo_percent_off?: number | null
          active_promotion_code_id?: string | null
          attribution_captured_at?: string | null
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          first_landing_page?: string | null
          first_referrer?: string | null
          id?: string
          is_admin?: boolean
          is_paid?: boolean
          is_sales?: boolean
          organization_name?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          active_promo_code?: string | null
          active_promo_expires_at?: string | null
          active_promo_percent_off?: number | null
          active_promotion_code_id?: string | null
          attribution_captured_at?: string | null
          avatar_url?: string | null
          created_at?: string
          current_period_end?: string | null
          display_name?: string | null
          first_landing_page?: string | null
          first_referrer?: string | null
          id?: string
          is_admin?: boolean
          is_paid?: boolean
          is_sales?: boolean
          organization_name?: string | null
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      scout_rate_limits: {
        Row: {
          created_at: string
          event_id: string
          id: number
          token: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: number
          token: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: number
          token?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          completed_at: string | null
          event_id: string
          event_type: string
          processed_at: string
        }
        Insert: {
          completed_at?: string | null
          event_id: string
          event_type: string
          processed_at?: string
        }
        Update: {
          completed_at?: string | null
          event_id?: string
          event_type?: string
          processed_at?: string
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
          session_secret: string
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
          session_secret: string
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
          session_secret?: string
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
          registration_url: string | null
          route_count: number | null
          routes: Json | null
          slug: string | null
          start_time: string | null
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
          registration_url?: string | null
          route_count?: number | null
          routes?: Json | null
          slug?: string | null
          start_time?: string | null
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
          registration_url?: string | null
          route_count?: number | null
          routes?: Json | null
          slug?: string | null
          start_time?: string | null
          tracking_end?: string | null
          tracking_start?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_get_event: {
        Args: { p_ref: string }
        Returns: {
          comp_grant_id: string
          event_date: string
          id: string
          name: string
          owner_email: string
          owner_id: string
          paid_at: string
          poi_count: number
          route_count: number
          slug: string
          status: string
          stripe_payment_id: string
          updated_at: string
        }[]
      }
      admin_lookup_user_by_email: {
        Args: { p_email: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          user_id: string
        }[]
      }
      admin_transfer_event: {
        Args: { p_event_id: string; p_note?: string; p_to_email: string }
        Returns: {
          event_id: string
          event_name: string
          event_slug: string
          pro_source: string
          to_email: string
        }[]
      }
      crm_assign_deal: {
        Args: { p_deal_id: string; p_owner_id: string }
        Returns: Json
      }
      crm_claim_deal: { Args: { p_deal_id: string }; Returns: Json }
      crm_create_deal: { Args: { p_deal: Json }; Returns: Json }
      crm_export: { Args: never; Returns: Json }
      crm_get_deal: { Args: { p_slug: string }; Returns: Json }
      crm_import: {
        Args: {
          p_dry_run?: boolean
          p_mode?: string
          p_rows: Json
          p_source: string
        }
        Returns: Json
      }
      crm_link_event: {
        Args: { p_deal_id: string; p_event_ref: string }
        Returns: Json
      }
      crm_list_deals: { Args: { p_include_closed?: boolean }; Returns: Json }
      crm_list_objections: { Args: never; Returns: Json }
      crm_list_signups: { Args: { p_scope?: string }; Returns: Json }
      crm_list_staff: { Args: never; Returns: Json }
      crm_log_activity: {
        Args: {
          p_body?: string
          p_deal_id: string
          p_meta?: Json
          p_occurred_at?: string
          p_quote?: string
          p_type: string
        }
        Returns: Json
      }
      crm_mark_dnc: {
        Args: { p_deal_id: string; p_reason: string; p_scope: string }
        Returns: Json
      }
      crm_release_deal: {
        Args: { p_deal_id: string; p_reason?: string }
        Returns: Json
      }
      crm_set_stage: {
        Args: {
          p_deal_id: string
          p_note?: string
          p_occurred_on?: string
          p_outcome?: string
          p_stage: string
        }
        Returns: Json
      }
      crm_triage_event: {
        Args: {
          p_action: string
          p_deal_id?: string
          p_event_id: string
          p_reason?: string
        }
        Returns: Json
      }
      crm_unlink_event: { Args: { p_event_id: string }; Returns: Json }
      crm_update_deal: {
        Args: {
          p_deal_id: string
          p_expected_updated_at?: string
          p_patch: Json
        }
        Returns: Json
      }
      crm_upsert_contact: {
        Args: { p_contact: Json; p_deal_id: string }
        Returns: Json
      }
      crm_void_activity: {
        Args: { p_activity_id: string; p_reason: string }
        Returns: Json
      }
      event_owner_is_paid: { Args: { owner_id: string }; Returns: boolean }
      get_admin_overview: { Args: { p_days?: number }; Returns: Json }
      get_event_analytics: { Args: { p_event_id: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      staff_role: { Args: never; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
