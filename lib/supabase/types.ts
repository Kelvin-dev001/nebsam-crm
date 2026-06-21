export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      telemarketers: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          full_name: string
          email: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
        }
      }
      leads: {
        Row: {
          id: string
          phone_number: string
          assigned_to: string | null
          full_name: string | null
          location: string | null
          vehicle_type: string | null
          product_interested: string | null
          lead_source: string
          funnel_stage: string
          rag_status: string
          campaign_name: string | null
          whatsapp_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          phone_number: string
          assigned_to?: string | null
          full_name?: string | null
          location?: string | null
          vehicle_type?: string | null
          product_interested?: string | null
          lead_source?: string
          funnel_stage?: string
          rag_status?: string
          campaign_name?: string | null
          whatsapp_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          phone_number?: string
          assigned_to?: string | null
          full_name?: string | null
          location?: string | null
          vehicle_type?: string | null
          product_interested?: string | null
          lead_source?: string
          funnel_stage?: string
          rag_status?: string
          campaign_name?: string | null
          whatsapp_message?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      call_logs: {
        Row: {
          id: string
          lead_id: string
          telemarketer_id: string
          called_at: string
          duration_seconds: number | null
          call_outcome: string
          call_notes: string | null
          next_followup_date: string | null
          next_followup_notes: string | null
          rag_status_after_call: string | null
          funnel_stage_after_call: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          telemarketer_id: string
          called_at?: string
          duration_seconds?: number | null
          call_outcome: string
          call_notes?: string | null
          next_followup_date?: string | null
          next_followup_notes?: string | null
          rag_status_after_call?: string | null
          funnel_stage_after_call?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          telemarketer_id?: string
          called_at?: string
          duration_seconds?: number | null
          call_outcome?: string
          call_notes?: string | null
          next_followup_date?: string | null
          next_followup_notes?: string | null
          rag_status_after_call?: string | null
          funnel_stage_after_call?: string | null
          created_at?: string
        }
      }
      sales: {
        Row: {
          id: string
          lead_id: string
          telemarketer_id: string
          product: string
          sale_amount: number | null
          currency: string
          installation_date: string | null
          installation_location: string | null
          sale_date: string
          vehicle_registration: string | null
          serial_number: string | null
          subscription_type: string
          renewal_due_date: string | null
          renewal_reminder_sent: boolean
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          telemarketer_id: string
          product: string
          sale_amount?: number | null
          currency?: string
          installation_date?: string | null
          installation_location?: string | null
          sale_date?: string
          vehicle_registration?: string | null
          serial_number?: string | null
          subscription_type?: string
          renewal_due_date?: string | null
          renewal_reminder_sent?: boolean
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          telemarketer_id?: string
          product?: string
          sale_amount?: number | null
          currency?: string
          installation_date?: string | null
          installation_location?: string | null
          sale_date?: string
          vehicle_registration?: string | null
          serial_number?: string | null
          subscription_type?: string
          renewal_due_date?: string | null
          renewal_reminder_sent?: boolean
          notes?: string | null
          created_at?: string
        }
      }
      followup_schedule: {
        Row: {
          id: string
          lead_id: string
          sale_id: string | null
          telemarketer_id: string
          followup_type: string
          scheduled_date: string
          notes: string | null
          status: string
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          sale_id?: string | null
          telemarketer_id: string
          followup_type: string
          scheduled_date: string
          notes?: string | null
          status?: string
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          sale_id?: string | null
          telemarketer_id?: string
          followup_type?: string
          scheduled_date?: string
          notes?: string | null
          status?: string
          completed_at?: string | null
          created_at?: string
        }
      }
      webhook_events: {
        Row: {
          id: string
          raw_payload: Json
          phone_number: string | null
          processed: boolean
          lead_id: string | null
          received_at: string
        }
        Insert: {
          id?: string
          raw_payload: Json
          phone_number?: string | null
          processed?: boolean
          lead_id?: string | null
          received_at?: string
        }
        Update: {
          id?: string
          raw_payload?: Json
          phone_number?: string | null
          processed?: boolean
          lead_id?: string | null
          received_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

// Convenience row types
export type TelemarketerRow = Database["public"]["Tables"]["telemarketers"]["Row"]
export type LeadRow         = Database["public"]["Tables"]["leads"]["Row"]
export type CallLogRow      = Database["public"]["Tables"]["call_logs"]["Row"]
export type SaleRow         = Database["public"]["Tables"]["sales"]["Row"]
export type FollowUpRow     = Database["public"]["Tables"]["followup_schedule"]["Row"]
export type WebhookEventRow = Database["public"]["Tables"]["webhook_events"]["Row"]
