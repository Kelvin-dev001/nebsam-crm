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
          department_id: string
          job_title: string | null
          id: string
          full_name: string
          email: string
          phone: string | null
          is_active: boolean
          created_at: string
          user_id: string | null
        }
        Insert: {
          department_id?: string | null
          job_title?: string | null
          id?: string
          full_name: string
          email: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          user_id?: string | null
        }
        Update: {
          department_id?: string | null
          job_title?: string | null
          id?: string
          full_name?: string
          email?: string
          phone?: string | null
          is_active?: boolean
          created_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          department_id: string
          kyc: Json
          created_by: string | null
          company_name: string | null
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
          department_id?: string | null
          kyc?: Json
          created_by?: string | null
          company_name?: string | null
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
          department_id?: string | null
          kyc?: Json
          created_by?: string | null
          company_name?: string | null
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
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "telemarketers"
            referencedColumns: ["id"]
          }
        ]
      }
      call_logs: {
        Row: {
          department_id: string
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
          department_id?: string | null
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
          department_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_telemarketer_id_fkey"
            columns: ["telemarketer_id"]
            isOneToOne: false
            referencedRelation: "telemarketers"
            referencedColumns: ["id"]
          }
        ]
      }
      sales: {
        Row: {
          department_id: string
          contract_start: string | null
          contract_end: string | null
          billing_cycle: string | null
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
          department_id?: string | null
          contract_start?: string | null
          contract_end?: string | null
          billing_cycle?: string | null
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
          department_id?: string | null
          contract_start?: string | null
          contract_end?: string | null
          billing_cycle?: string | null
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
        Relationships: [
          {
            foreignKeyName: "sales_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_telemarketer_id_fkey"
            columns: ["telemarketer_id"]
            isOneToOne: false
            referencedRelation: "telemarketers"
            referencedColumns: ["id"]
          }
        ]
      }
      followup_schedule: {
        Row: {
          department_id: string
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
          department_id?: string | null
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
          department_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "followup_schedule_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_schedule_telemarketer_id_fkey"
            columns: ["telemarketer_id"]
            isOneToOne: false
            referencedRelation: "telemarketers"
            referencedColumns: ["id"]
          }
        ]
      }
      webhook_events: {
        Row: {
          id: string
          raw_payload: Json
          phone_number: string | null
          processed: boolean
          lead_id: string | null
          received_at: string
          direction: string | null
          message_text: string | null
          sent_at: string
        }
        Insert: {
          id?: string
          raw_payload: Json
          phone_number?: string | null
          processed?: boolean
          lead_id?: string | null
          received_at?: string
          direction?: string | null
          message_text?: string | null
          sent_at?: string
        }
        Update: {
          id?: string
          raw_payload?: Json
          phone_number?: string | null
          processed?: boolean
          lead_id?: string | null
          received_at?: string
          direction?: string | null
          message_text?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          }
        ]
      }
      round_robin_state: {
        Row: {
          department_id: string
          id: string
          last_assigned_telemarketer_id: string | null
          updated_at: string
        }
        Insert: {
          department_id?: string | null
          id?: string
          last_assigned_telemarketer_id?: string | null
          updated_at?: string
        }
        Update: {
          department_id?: string | null
          id?: string
          last_assigned_telemarketer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_state_last_assigned_telemarketer_id_fkey"
            columns: ["last_assigned_telemarketer_id"]
            isOneToOne: false
            referencedRelation: "telemarketers"
            referencedColumns: ["id"]
          }
        ]
      }
      departments: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          lead_intake: string
          assignment_mode: string
          post_sale_model: string
          accent_color: string
          icon: string | null
          is_active: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          lead_intake?: string
          assignment_mode?: string
          post_sale_model?: string
          accent_color?: string
          icon?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          lead_intake?: string
          assignment_mode?: string
          post_sale_model?: string
          accent_color?: string
          icon?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      funnel_stages: {
        Row: {
          id: string
          department_id: string
          key: string
          label: string
          sort_order: number
          color: string
          is_active_stage: boolean
          is_won: boolean
          is_terminal: boolean
          created_at: string
        }
        Insert: {
          id?: string
          department_id: string
          key: string
          label: string
          sort_order: number
          color?: string
          is_active_stage?: boolean
          is_won?: boolean
          is_terminal?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          department_id?: string | null
          key?: string
          label?: string
          sort_order?: number
          color?: string
          is_active_stage?: boolean
          is_won?: boolean
          is_terminal?: boolean
          created_at?: string
        }
        Relationships: []
      }
      kyc_fields: {
        Row: {
          id: string
          department_id: string
          key: string
          label: string
          field_type: string
          options: Json | null
          is_required: boolean
          help_text: string | null
          sort_order: number
          show_in_table: boolean
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          department_id: string
          key: string
          label: string
          field_type: string
          options?: Json | null
          is_required?: boolean
          help_text?: string | null
          sort_order?: number
          show_in_table?: boolean
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          department_id?: string | null
          key?: string
          label?: string
          field_type?: string
          options?: Json | null
          is_required?: boolean
          help_text?: string | null
          sort_order?: number
          show_in_table?: boolean
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      department_products: {
        Row: {
          id: string
          department_id: string
          name: string
          unit_price: number | null
          currency: string
          is_active: boolean
          sort_order: number
        }
        Insert: {
          id?: string
          department_id: string
          name: string
          unit_price?: number | null
          currency?: string
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          id?: string
          department_id?: string | null
          name?: string
          unit_price?: number | null
          currency?: string
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      service_orders: {
        Row: {
          id: string
          lead_id: string
          department_id: string
          telemarketer_id: string
          order_date: string
          product: string
          quantity: number
          unit_price: number | null
          total_amount: number | null
          currency: string
          delivery_date: string | null
          delivery_status: string
          reorder_due_date: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          department_id: string
          telemarketer_id: string
          order_date?: string
          product: string
          quantity: number
          unit_price?: number | null
          total_amount?: number | null
          currency?: string
          delivery_date?: string | null
          delivery_status?: string
          reorder_due_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          department_id?: string | null
          telemarketer_id?: string
          order_date?: string
          product?: string
          quantity?: number
          unit_price?: number | null
          total_amount?: number | null
          currency?: string
          delivery_date?: string | null
          delivery_status?: string
          reorder_due_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      academic_terms: {
        Row: {
          id: string
          year: number
          term_number: number
          name: string
          start_date: string
          end_date: string
          holiday_start: string | null
          holiday_end: string | null
          created_at: string
        }
        Insert: {
          id?: string
          year: number
          term_number: number
          name: string
          start_date: string
          end_date: string
          holiday_start?: string | null
          holiday_end?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          year?: number
          term_number?: number
          name?: string
          start_date?: string
          end_date?: string
          holiday_start?: string | null
          holiday_end?: string | null
          created_at?: string
        }
        Relationships: []
      }
      school_buses: {
        Row: {
          id: string
          lead_id: string
          department_id: string
          registration_number: string
          route_name: string | null
          capacity: number | null
          device_serial: string | null
          device_product: string | null
          install_date: string | null
          status: string
          rate_per_term: number | null
          currency: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          department_id: string
          registration_number: string
          route_name?: string | null
          capacity?: number | null
          device_serial?: string | null
          device_product?: string | null
          install_date?: string | null
          status?: string
          rate_per_term?: number | null
          currency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          department_id?: string | null
          registration_number?: string
          route_name?: string | null
          capacity?: number | null
          device_serial?: string | null
          device_product?: string | null
          install_date?: string | null
          status?: string
          rate_per_term?: number | null
          currency?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      term_billings: {
        Row: {
          id: string
          lead_id: string
          sale_id: string | null
          department_id: string
          academic_term_id: string
          bus_count: number
          amount_per_bus: number | null
          total_amount: number | null
          currency: string
          due_date: string | null
          invoice_status: string
          paid_date: string | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          sale_id?: string | null
          department_id: string
          academic_term_id: string
          bus_count?: number
          amount_per_bus?: number | null
          total_amount?: number | null
          currency?: string
          due_date?: string | null
          invoice_status?: string
          paid_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          lead_id?: string
          sale_id?: string | null
          department_id?: string | null
          academic_term_id?: string
          bus_count?: number
          amount_per_bus?: number | null
          total_amount?: number | null
          currency?: string
          due_date?: string | null
          invoice_status?: string
          paid_date?: string | null
          notes?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      rename_funnel_stage: {
        Args: { p_stage_id: string; p_new_key: string }
        Returns: Json
      }
      reorder_funnel_stages: {
        Args: { p_stage_ids: string[] }
        Returns: Json
      }
      validate_academic_terms: {
        Args: Record<string, never>
        Returns: Json
      }
      assign_lead_round_robin_v2: {
        Args: {
          p_department_slug: string
          p_phone: string
          p_name: string
          p_message: string
          p_campaign: string
          p_raw_payload: Json
        }
        Returns: Json
      }
      create_manual_lead: {
        Args: {
          p_department_slug: string
          p_phone: string
          p_company?: string | null
          p_contact_name?: string | null
          p_kyc?: Json
          p_product?: string | null
          p_source?: string
          p_created_by?: string | null
          p_location?: string | null
        }
        Returns: Database["public"]["Tables"]["leads"]["Row"]
      }
      check_phone_across_departments: {
        Args: { p_phone: string }
        Returns: {
          department_id: string
          department_slug: string
          department_name: string
          funnel_stage: string
          assigned_rep: string | null
          created_at: string
        }[]
      }
      generate_term_billings: {
        Args: { p_sale_id: string }
        Returns: Json
      }
      is_school_holiday: {
        Args: { p_date: string }
        Returns: boolean
      }
      normalize_phone_ke: {
        Args: { p_phone: string }
        Returns: string
      }
      rag_auto_flag_v2: {
        Args: { p_dry_run?: boolean }
        Returns: Json
      }
      assign_lead_round_robin: {
        Args: {
          p_phone: string
          p_name: string | null
          p_message: string | null
          p_campaign: string | null
          p_raw_payload: Json
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
  }
}

// Convenience row types
export type TelemarketerRow   = Database["public"]["Tables"]["telemarketers"]["Row"]
export type LeadRow           = Database["public"]["Tables"]["leads"]["Row"]
export type CallLogRow        = Database["public"]["Tables"]["call_logs"]["Row"]
export type SaleRow           = Database["public"]["Tables"]["sales"]["Row"]
export type FollowUpRow       = Database["public"]["Tables"]["followup_schedule"]["Row"]
export type WebhookEventRow   = Database["public"]["Tables"]["webhook_events"]["Row"]
export type RoundRobinStateRow = Database["public"]["Tables"]["round_robin_state"]["Row"]
export type DepartmentRow        = Database["public"]["Tables"]["departments"]["Row"]
export type FunnelStageRow       = Database["public"]["Tables"]["funnel_stages"]["Row"]
export type KycFieldRow          = Database["public"]["Tables"]["kyc_fields"]["Row"]
export type DepartmentProductRow = Database["public"]["Tables"]["department_products"]["Row"]
export type ServiceOrderRow      = Database["public"]["Tables"]["service_orders"]["Row"]
export type AcademicTermRow      = Database["public"]["Tables"]["academic_terms"]["Row"]
export type SchoolBusRow         = Database["public"]["Tables"]["school_buses"]["Row"]
export type TermBillingRow       = Database["public"]["Tables"]["term_billings"]["Row"]
