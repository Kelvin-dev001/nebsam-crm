import { FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_LABELS } from "@/types/crm"
import type { FunnelStageDef, StageKey } from "@/types/crm"

// ────────────────────────────────────────────────────────────────────────────
// Funnel helpers.
//
// Stages are per-department configuration from migration 009 onwards, so the
// useful functions here take a FunnelStageDef[] and read labels, ordering and
// colours out of it.
//
// The original hardcoded helpers are KEPT, unchanged, below. They are what the
// existing telematics pages call, and Sprint D3's contract is that telematics
// behaves byte-for-byte as before. They also serve as the fallback whenever
// config has not loaded yet — a rep should see a correctly labelled funnel
// during the first paint, not a flash of raw snake_case keys.
// ────────────────────────────────────────────────────────────────────────────

// ── Config-driven (use these in new code) ───────────────────────────────────

/** Ordered stages, filtered to a department's config. */
export function orderedStages(stages: FunnelStageDef[]): FunnelStageDef[] {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order)
}

export function findStage(stages: FunnelStageDef[], key: StageKey): FunnelStageDef | undefined {
  return stages.find((s) => s.key === key)
}

/**
 * Label for a stage key. Falls back to the telematics labels, then to a
 * title-cased version of the key itself, so an unknown stage renders as
 * "Board Review" rather than "board_review" or an empty badge.
 */
export function stageLabel(key: StageKey, stages: FunnelStageDef[] = []): string {
  const fromConfig = findStage(stages, key)?.label
  if (fromConfig) return fromConfig

  const legacy = FUNNEL_STAGE_LABELS[key as FunnelStage]
  if (legacy) return legacy

  return titleCase(key)
}

export function stageIndex(key: StageKey, stages: FunnelStageDef[]): number {
  const s = findStage(stages, key)
  return s ? s.sort_order : -1
}

/** In the pipeline for RAG and stats — mirrors funnel_stages.is_active_stage. */
export function isActiveStage(key: StageKey, stages: FunnelStageDef[]): boolean {
  const s = findStage(stages, key)
  return s ? s.is_active_stage : isActiveLead(key as FunnelStage)
}

/** Reveals the Sale tab. */
export function isWonStage(key: StageKey, stages: FunnelStageDef[]): boolean {
  const s = findStage(stages, key)
  return s ? s.is_won : key === "won"
}

/** lost / unqualified / dormant. */
export function isTerminalStage(key: StageKey, stages: FunnelStageDef[]): boolean {
  const s = findStage(stages, key)
  return s ? s.is_terminal : ["lost", "unqualified"].includes(key)
}

/** 0-1 progress through a department's funnel, for progress bars. */
export function stageProgress(key: StageKey, stages: FunnelStageDef[]): number {
  const ordered = orderedStages(stages).filter((s) => !s.is_terminal)
  if (ordered.length === 0) return 0
  const i = ordered.findIndex((s) => s.key === key)
  return i < 0 ? 0 : (i + 1) / ordered.length
}

function titleCase(key: string): string {
  return key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

// ── Original telematics helpers — unchanged behaviour ───────────────────────
// Do not "simplify" these into the config-driven versions above. The existing
// pages depend on exactly this behaviour, and D3 must not change it.

export function getFunnelStageLabel(stage: FunnelStage): string {
  return FUNNEL_STAGE_LABELS[stage]
}

export function getFunnelStageIndex(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage)
}

export function isActiveLead(stage: FunnelStage): boolean {
  return !["lost", "unqualified", "renewed"].includes(stage)
}

export function isPostSale(stage: FunnelStage): boolean {
  return ["won", "installed", "post_sale", "sorted", "renewal_due", "renewed"].includes(stage)
}

export const FUNNEL_STAGE_COLORS: Record<FunnelStage, string> = {
  new: "bg-slate-500",
  contacted: "bg-blue-500",
  interested: "bg-cyan-500",
  quote_sent: "bg-violet-500",
  negotiating: "bg-amber-500",
  won: "bg-green-600",
  installed: "bg-green-700",
  post_sale: "bg-teal-600",
  sorted: "bg-purple-500",
  renewal_due: "bg-orange-500",
  renewed: "bg-emerald-600",
  lost: "bg-red-600",
  unqualified: "bg-slate-400",
}

/**
 * Badge classes for a stage from any department.
 *
 * Telematics keys keep their EXACT existing classes, including the two that do
 * not follow the generic pattern (`installed` is green-200/800, `unqualified`
 * is slate with lighter text). Section 10 requires the telematics UI to render
 * identically after the migration, and a colour family alone cannot express
 * those two, so the literal map wins for keys it knows.
 */
const STAGE_BADGE_CLASSES: Record<string, string> = {
  new: "bg-slate-100 text-slate-600 border-slate-200",
  contacted: "bg-blue-100 text-blue-700 border-blue-200",
  interested: "bg-cyan-100 text-cyan-700 border-cyan-200",
  quote_sent: "bg-violet-100 text-violet-700 border-violet-200",
  negotiating: "bg-amber-100 text-amber-700 border-amber-200",
  won: "bg-green-100 text-green-700 border-green-200",
  installed: "bg-green-200 text-green-800 border-green-300",
  post_sale: "bg-teal-100 text-teal-700 border-teal-200",
  sorted: "bg-purple-100 text-purple-700 border-purple-200",
  renewal_due: "bg-orange-100 text-orange-700 border-orange-200",
  renewed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  lost: "bg-red-100 text-red-700 border-red-200",
  unqualified: "bg-slate-100 text-slate-400 border-slate-200",
}

/** Colour families a configured stage may use, as literal Tailwind classes. */
const COLOR_FAMILY_CLASSES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-600 border-slate-200",
  zinc: "bg-zinc-100 text-zinc-600 border-zinc-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  sky: "bg-sky-100 text-sky-700 border-sky-200",
  cyan: "bg-cyan-100 text-cyan-700 border-cyan-200",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-200",
  violet: "bg-violet-100 text-violet-700 border-violet-200",
  purple: "bg-purple-100 text-purple-700 border-purple-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
  green: "bg-green-100 text-green-700 border-green-200",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
  teal: "bg-teal-100 text-teal-700 border-teal-200",
  red: "bg-red-100 text-red-700 border-red-200",
}

/**
 * Two stages use a shade a colour family cannot express, and section 10
 * requires them to keep rendering exactly as they do today. They are therefore
 * pinned, and an admin editing their colour in the Departments tab will not
 * change them. Every other stage, in every department, honours its configured
 * colour — which is the point of making stages configuration in the first place.
 */
const SHADE_OVERRIDES: Record<string, string> = {
  installed: "bg-green-200 text-green-800 border-green-300",
  unqualified: "bg-slate-100 text-slate-400 border-slate-200",
}

export function stageBadgeClasses(key: StageKey, stages: FunnelStageDef[] = []): string {
  if (SHADE_OVERRIDES[key]) return SHADE_OVERRIDES[key]

  // Configured colour wins, so admin edits actually take effect.
  const family = findStage(stages, key)?.color
  if (family && COLOR_FAMILY_CLASSES[family]) return COLOR_FAMILY_CLASSES[family]

  // No config loaded yet (first paint) — fall back to the original literals.
  return STAGE_BADGE_CLASSES[key] ?? COLOR_FAMILY_CLASSES.slate
}
