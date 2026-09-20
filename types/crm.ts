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
  | "Hybrid Pro Max Alarm"
  | "Hybrid Pro Max Plus Alarm"
  | "Hybrid Car Tracker"
  | "Hybrid Pro Tracker"
  | "Hybrid Pro Max Tracker"
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
  "Hybrid Pro Max Alarm",
  "Hybrid Pro Max Plus Alarm",
  "Hybrid Car Tracker",
  "Hybrid Pro Tracker",
  "Hybrid Pro Max Tracker",
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
  user_id?: string | null
  department_id?: string
  job_title?: string | null
}

/**
 * The UI calls these people "Sales Reps" from the multi-department work
 * onwards. The TABLE is not renamed: `telemarketers` is referenced across ~40
 * files and every RPC, and renaming it buys nothing. Use `Rep` in new code.
 */
export type Rep = Telemarketer

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
  department_id?: string
  kyc?: Record<string, unknown>
  company_name?: string | null
  created_by?: string | null
  department?: Department
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
  department_id?: string
  contract_start?: string | null
  contract_end?: string | null
  billing_cycle?: BillingCycle | null
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

// ────────────────────────────────────────────────────────────────────────────
// Multi-department types (migration 009).
//
// Departments, their funnel stages, their KYC questions and their product
// catalogues all live in the DATABASE, not in this file. That is decision D3:
// adding a stage, a KYC question or a fourth department is an admin action,
// not a deploy. The unions below stay only where the value set is genuinely
// fixed by code.
// ────────────────────────────────────────────────────────────────────────────

/**
 * A funnel stage key, per department. Deliberately a plain string: stages are
 * configuration, so the compiler cannot know them.
 *
 * `FunnelStage` above is kept as a union for the existing telematics code
 * paths, which are typed against the original 13. New code should use
 * `StageKey` and resolve labels and colours through the funnel_stages config.
 */
export type StageKey = string

/**
 * How a department earns after the sale. Switch on this EXHAUSTIVELY, with a
 * `never` default case, so adding a fifth model fails the build instead of
 * silently rendering nothing.
 */
export type PostSaleModel =
  | "annual_renewal"   // telematics: install + 365 days
  | "subscription"     // fuel: contract with an end date
  | "consumption"      // e-seal: reorders by volume, no renewal
  | "term_contract"    // school bus: billed once per term, 3 terms a year
  | "none"

export type LeadIntake = "whatsapp_webhook" | "manual"
export type AssignmentMode = "round_robin" | "creator" | "unassigned"
export type BillingCycle = "monthly" | "quarterly" | "termly" | "annual" | "once_off"

export type KycFieldType =
  | "text" | "textarea" | "number" | "select" | "multiselect"
  | "boolean" | "date" | "phone" | "email"

export type DeliveryStatus = "pending" | "delivered" | "cancelled"
export type SchoolBusStatus =
  | "prospective" | "scheduled" | "installed" | "active" | "suspended" | "removed"
export type InvoiceStatus =
  | "pending" | "invoiced" | "paid" | "partial" | "overdue" | "waived"

export interface Department {
  id: string
  slug: string
  name: string
  description: string | null
  lead_intake: LeadIntake
  assignment_mode: AssignmentMode
  post_sale_model: PostSaleModel
  accent_color: string
  icon: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface FunnelStageDef {
  id: string
  department_id: string
  key: StageKey
  label: string
  sort_order: number
  color: string
  /** Counts as "in the pipeline" for RAG and stats. Mirrors rag_auto_flag's active_stages. */
  is_active_stage: boolean
  /** Reveals the Sale tab. */
  is_won: boolean
  /** lost / unqualified / dormant. */
  is_terminal: boolean
  created_at: string
}

export interface KycFieldDef {
  id: string
  department_id: string
  /** Key inside leads.kyc — EXCEPT for the promoted keys, see PROMOTED_KYC_KEYS. */
  key: string
  label: string
  field_type: KycFieldType
  options: string[] | null
  is_required: boolean
  help_text: string | null
  sort_order: number
  show_in_table: boolean
  is_active: boolean
  created_at: string
}

/**
 * KYC keys that are NOT stored in leads.kyc but in real columns on `leads`.
 *
 * Telematics' four KYC fields were native columns long before leads.kyc
 * existed, and company_name is deliberately promoted out of the JSONB so it can
 * be indexed, searched and reported on. A renderer that blindly writes these
 * into leads.kyc will make the telematics team's names and locations vanish
 * from the leads table and from reports while still looking correct in the
 * modal — so every read and write path must consult this map.
 */
export const PROMOTED_KYC_KEYS: Record<string, keyof Lead> = {
  full_name: "full_name",
  location: "location",
  vehicle_type: "vehicle_type",
  product_interested: "product_interested",
  company_name: "company_name",
}

export function isPromotedKycKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROMOTED_KYC_KEYS, key)
}

export interface DepartmentProduct {
  id: string
  department_id: string
  name: string
  unit_price: number | null
  currency: string
  is_active: boolean
  sort_order: number
}

export interface ServiceOrder {
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
  delivery_status: DeliveryStatus
  /** Drives the Reorders page and the consumption RAG rule. */
  reorder_due_date: string | null
  notes: string | null
  created_at: string
  lead?: Lead
}

export interface AcademicTerm {
  id: string
  year: number
  term_number: 1 | 2 | 3
  name: string
  start_date: string
  end_date: string
  /** The break FOLLOWING this term. */
  holiday_start: string | null
  holiday_end: string | null
  created_at: string
}

export interface SchoolBus {
  id: string
  lead_id: string
  department_id: string
  registration_number: string
  route_name: string | null
  capacity: number | null
  device_serial: string | null
  device_product: string | null
  install_date: string | null
  status: SchoolBusStatus
  rate_per_term: number | null
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
  lead?: Lead
}

export interface TermBilling {
  id: string
  lead_id: string
  sale_id: string | null
  department_id: string
  academic_term_id: string
  /** From the VERIFIED bus register, never from the kyc bus_count claim. */
  bus_count: number
  amount_per_bus: number | null
  total_amount: number | null
  currency: string
  /** Term start minus 14 days. */
  due_date: string | null
  invoice_status: InvoiceStatus
  paid_date: string | null
  notes: string | null
  created_at: string
  lead?: Lead
  academic_term?: AcademicTerm
}

/** The full configuration for one department, loaded once per session. */
export interface DepartmentConfig {
  department: Department
  stages: FunnelStageDef[]
  kycFields: KycFieldDef[]
  products: DepartmentProduct[]
}
