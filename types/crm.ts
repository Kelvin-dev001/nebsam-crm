export type FunnelStage =
  | "new"
  | "contacted"
  | "interested"
  | "quote_sent"
  | "negotiating"
  | "won"
  | "installed"
  | "post_sale"
  | "sorted"
  | "renewal_due"
  | "renewed"
  | "lost"
  | "unqualified"

export type RAGStatus = "green" | "amber" | "red"

export type Product =
  | "Fuel Monitoring Solution"
  | "Hybrid Car Alarm"
  | "Hybrid Car Tracker"
  | "Vehicle Video Telematics"
  | "Hybrid Dash Cam"
  | "Recovery Tracker"
  | "Bluetooth Tracker"
  | "Anti-Jammer Tracker"
  | "Other (specify)"

export type CallOutcome =
  | "answered"
  | "no_answer"
  | "busy"
  | "callback_requested"
  | "wrong_number"

export type LeadSource =
  | "whatsapp_bot"
  | "meta_ads"
  | "tiktok_ads"
  | "referral"
  | "manual"

export type FollowUpType = "pre_sale" | "post_sale_renewal" | "check_in"

export type FollowUpStatus = "pending" | "completed" | "missed" | "rescheduled"

export type SubscriptionType = "annual" | "once_off"

export type RenewalStatus = "pending" | "reminded" | "renewed" | "churned"

export const FUNNEL_STAGES: FunnelStage[] = [
  "new",
  "contacted",
  "interested",
  "quote_sent",
  "negotiating",
  "won",
  "installed",
  "post_sale",
  "sorted",
  "renewal_due",
  "renewed",
  "lost",
  "unqualified",
]

export const PRODUCTS: Product[] = [
  "Fuel Monitoring Solution",
  "Hybrid Car Alarm",
  "Hybrid Car Tracker",
  "Vehicle Video Telematics",
  "Hybrid Dash Cam",
  "Recovery Tracker",
  "Bluetooth Tracker",
  "Anti-Jammer Tracker",
  "Other (specify)",
]

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  quote_sent: "Quote Sent",
  negotiating: "Negotiating",
  won: "Won",
  installed: "Installed",
  post_sale: "Post-Sale",
  sorted: "Sorted",
  renewal_due: "Renewal Due",
  renewed: "Renewed",
  lost: "Lost",
  unqualified: "Unqualified",
}

export interface Telemarketer {
  id: string
  full_name: string
  email: string
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface Lead {
  id: string
  phone_number: string
  assigned_to: string | null
  full_name: string | null
  location: string | null
  vehicle_type: string | null
  product_interested: Product | null
  lead_source: LeadSource
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  campaign_name: string | null
  whatsapp_message: string | null
  created_at: string
  updated_at: string
  telemarketer?: Telemarketer
}

export interface CallLog {
  id: string
  lead_id: string
  telemarketer_id: string
  called_at: string
  duration_seconds: number | null
  call_outcome: CallOutcome
  call_notes: string | null
  next_followup_date: string | null
  next_followup_notes: string | null
  rag_status_after_call: RAGStatus | null
  funnel_stage_after_call: FunnelStage | null
  created_at: string
  telemarketer?: Telemarketer
}

export interface Sale {
  id: string
  lead_id: string
  telemarketer_id: string
  product: Product
  sale_amount: number | null
  currency: string
  installation_date: string | null
  installation_location: string | null
  sale_date: string
  vehicle_registration: string | null
  serial_number: string | null
  subscription_type: SubscriptionType
  renewal_due_date: string | null
  renewal_reminder_sent: boolean
  notes: string | null
  created_at: string
  lead?: Lead
  telemarketer?: Telemarketer
}

export interface FollowUp {
  id: string
  lead_id: string
  sale_id: string | null
  telemarketer_id: string
  followup_type: FollowUpType
  scheduled_date: string
  notes: string | null
  status: FollowUpStatus
  completed_at: string | null
  created_at: string
  lead?: Lead
  telemarketer?: Telemarketer
}

export interface RoundRobinState {
  id: string
  last_assigned_telemarketer_id: string | null
  updated_at: string
}

export interface WebhookEvent {
  id: string
  raw_payload: Record<string, unknown>
  phone_number: string | null
  processed: boolean
  lead_id: string | null
  received_at: string
}
