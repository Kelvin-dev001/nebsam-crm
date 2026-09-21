import { z } from "zod"
import type { KycFieldDef, Lead } from "@/types/crm"
import { PROMOTED_KYC_KEYS, isPromotedKycKey } from "@/types/crm"
import { normalizePhone, isValidPhone } from "./phoneHelpers"

/**
 * Rendering and validating the per-department KYC field set.
 *
 * KYC questions are rows in `kyc_fields`, so the form is built at runtime from
 * config rather than written in JSX. Answers live in `leads.kyc` (JSONB) —
 * EXCEPT for the promoted keys, which are real columns. See PROMOTED_KYC_KEYS
 * in types/crm.ts for why that distinction matters.
 */

export type KycValues = Record<string, unknown>

/** Build a Zod schema for one department's field set. */
export function buildKycSchema(fields: KycFieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const f of fields) {
    if (!f.is_active) continue
    let s: z.ZodTypeAny

    switch (f.field_type) {
      case "number":
        // Inputs hand back strings; coerce, and treat "" as absent rather than 0.
        s = z.preprocess(
          (v) => (v === "" || v == null ? undefined : Number(v)),
          z.number({ message: `${f.label} must be a number` }).optional(),
        )
        break
      case "boolean":
        s = z.coerce.boolean().optional()
        break
      case "email":
        s = z.string().email(`${f.label} must be a valid email`).optional().or(z.literal(""))
        break
      case "phone":
        s = z
          .string()
          .optional()
          .refine((v) => !v || isValidPhone(v), {
            message: `${f.label} must be a valid phone number`,
          })
        break
      case "multiselect":
        s = z.array(z.string()).optional()
        break
      case "date":
        s = z.string().optional()
        break
      default:
        s = z.string().optional()
    }

    if (f.is_required) {
      if (f.field_type === "multiselect") {
        s = z.array(z.string()).min(1, `${f.label} is required`)
      } else if (f.field_type === "number") {
        s = z.preprocess(
          (v) => (v === "" || v == null ? undefined : Number(v)),
          z.number({ message: `${f.label} is required` }),
        )
      } else if (f.field_type === "boolean") {
        s = z.coerce.boolean()
      } else {
        s = z.string().min(1, `${f.label} is required`)
      }
    }

    shape[f.key] = s
  }

  return z.object(shape)
}

/** Defaults for a fresh form: "" for text, [] for multiselect, false for boolean. */
export function emptyKycValues(fields: KycFieldDef[]): KycValues {
  const out: KycValues = {}
  for (const f of fields) {
    if (!f.is_active) continue
    out[f.key] =
      f.field_type === "multiselect" ? [] : f.field_type === "boolean" ? false : ""
  }
  return out
}

/**
 * Populate a form from an existing lead, reading promoted keys from their
 * columns and everything else from leads.kyc.
 */
export function kycValuesFromLead(lead: Partial<Lead>, fields: KycFieldDef[]): KycValues {
  const stored = (lead.kyc ?? {}) as KycValues
  const out = emptyKycValues(fields)

  for (const f of fields) {
    if (!f.is_active) continue
    if (isPromotedKycKey(f.key)) {
      const col = PROMOTED_KYC_KEYS[f.key]
      const v = (lead as Record<string, unknown>)[col as string]
      out[f.key] = v ?? out[f.key]
    } else if (stored[f.key] !== undefined) {
      out[f.key] = stored[f.key]
    }
  }
  return out
}

/**
 * Split submitted answers into the JSONB blob and the promoted columns, so a
 * save is one write.
 *
 * `company_name` is special: it is BOTH a kyc key and a column, and section 6.4
 * requires the two to stay in sync in a single write. It is therefore written
 * to the column AND left in the blob.
 */
export function splitKycForSave(
  values: KycValues,
  fields: KycFieldDef[],
): { kyc: KycValues; columns: Record<string, unknown> } {
  const kyc: KycValues = {}
  const columns: Record<string, unknown> = {}

  for (const f of fields) {
    if (!f.is_active) continue
    let v = values[f.key]
    if (v === "" || v === undefined) continue
    if (f.field_type === "phone" && typeof v === "string") v = normalizePhone(v)

    if (isPromotedKycKey(f.key)) {
      columns[PROMOTED_KYC_KEYS[f.key] as string] = v
      if (f.key === "company_name") kyc[f.key] = v
    } else {
      kyc[f.key] = v
    }
  }

  return { kyc, columns }
}

/** Fields an admin marked as leads-table columns. */
export function tableColumnFields(fields: KycFieldDef[]): KycFieldDef[] {
  return fields
    .filter((f) => f.is_active && f.show_in_table)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Read one answer for display, from wherever it actually lives. */
export function readKycValue(lead: Partial<Lead>, key: string): unknown {
  if (isPromotedKycKey(key)) {
    return (lead as Record<string, unknown>)[PROMOTED_KYC_KEYS[key] as string]
  }
  return ((lead.kyc ?? {}) as KycValues)[key]
}

/** Human-readable form of an answer, for tables and the detail page. */
export function formatKycValue(value: unknown, field?: KycFieldDef): string {
  if (value == null || value === "") return "—"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (field?.field_type === "phone") return normalizePhone(String(value))
  return String(value)
}
