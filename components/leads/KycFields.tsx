"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { DepartmentProduct, KycFieldDef } from "@/types/crm"
import type { KycValues } from "@/lib/utils/kycHelpers"

/**
 * Renders a department's KYC question set from `kyc_fields` config.
 *
 * One renderer for every department, telematics included — its four questions
 * are seeded as kyc_fields rows like everyone else's, so there is exactly one
 * code path (section 7.4).
 *
 * Values are held by the PARENT as plain React state, never as RHF
 * `setValue`-only fields. That is the CallLogModal toggle rule: fields written
 * only through setValue collapse to their defaults on submit and silently drop
 * the rep's answers. Everything here is a controlled input reporting through
 * `onChange`.
 *
 * `product_interested` is special-cased to draw its options from the
 * department's product catalogue rather than from `options`, because products
 * are their own editable table.
 */

interface Props {
  fields: KycFieldDef[]
  values: KycValues
  onChange: (key: string, value: unknown) => void
  products?: DepartmentProduct[]
  errors?: Record<string, string>
  /** Tighter spacing, for use inside the call log drawer. */
  compact?: boolean
}

const selectClasses =
  "w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 " +
  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"

export function KycFields({ fields, values, onChange, products = [], errors = {}, compact }: Props) {
  const active = fields.filter((f) => f.is_active).sort((a, b) => a.sort_order - b.sort_order)
  if (active.length === 0) return null

  return (
    <div className={cn("grid gap-3", compact ? "gap-2" : "gap-3 sm:grid-cols-2")}>
      {active.map((field) => {
        const value = values[field.key]
        const error = errors[field.key]
        const id = `kyc-${field.key}`

        return (
          <div
            key={field.key}
            className={cn(
              "flex flex-col gap-1",
              // Long-form inputs get the full width of the grid.
              (field.field_type === "textarea" || field.field_type === "multiselect") &&
                "sm:col-span-2",
            )}
          >
            <label htmlFor={id} className="text-xs font-medium text-slate-600">
              {field.label}
              {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {renderControl(field, id, value, onChange, products)}

            {field.help_text && !error && (
              <span className="text-[11px] text-slate-400">{field.help_text}</span>
            )}
            {error && <span className="text-[11px] text-red-600">{error}</span>}
          </div>
        )
      })}
    </div>
  )
}

function renderControl(
  field: KycFieldDef,
  id: string,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
  products: DepartmentProduct[],
) {
  const str = value == null ? "" : String(value)

  switch (field.field_type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="text-sm min-h-16"
          placeholder={field.label}
        />
      )

    case "boolean":
      return (
        <label className="flex items-center gap-2 h-9">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-600">{value === true ? "Yes" : "No"}</span>
        </label>
      )

    case "number":
      return (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="h-9 text-sm"
          placeholder={field.label}
        />
      )

    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="h-9 text-sm"
        />
      )

    case "email":
      return (
        <Input
          id={id}
          type="email"
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="h-9 text-sm"
          placeholder="name@company.co.ke"
        />
      )

    case "phone":
      return (
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="h-9 text-sm font-mono"
          placeholder="07XX XXX XXX"
        />
      )

    case "select": {
      // The product question draws from the department's catalogue.
      const options =
        field.key === "product_interested"
          ? products.map((p) => p.name)
          : field.options ?? []
      return (
        <select
          id={id}
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={selectClasses}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }

    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : []
      const options = field.options ?? []
      return (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const on = selected.includes(o)
            return (
              <button
                key={o}
                type="button"
                onClick={() =>
                  onChange(
                    field.key,
                    on ? selected.filter((s) => s !== o) : [...selected, o],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  on
                    ? "bg-blue-100 text-blue-700 border-blue-300"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300",
                )}
              >
                {o}
              </button>
            )
          })}
        </div>
      )
    }

    default:
      return (
        <Input
          id={id}
          value={str}
          onChange={(e) => onChange(field.key, e.target.value)}
          className="h-9 text-sm"
          placeholder={field.label}
        />
      )
  }
}
