/**
 * Kenyan phone number handling.
 *
 * Every number in this system is stored as +254XXXXXXXXX. That is not a
 * cosmetic preference: `leads_dept_phone_uniq` is a UNIQUE index on
 * (department_id, phone_number), so two spellings of the same number are two
 * different leads, and the duplicate check silently stops working.
 *
 * This mirrors the `normalize_phone_ke()` SQL function exactly. The database
 * is the real guarantee — `create_manual_lead` normalises server-side — but
 * normalising on blur lets the rep see what will be stored before they save.
 * If you change the rules here, change them in 009c_departments_functions.sql
 * too, and vice versa.
 */

/**
 * Normalise Kenyan input to +254XXXXXXXXX.
 *
 *   0712345678      -> +254712345678
 *   712345678       -> +254712345678
 *   254712345678    -> +254712345678
 *   +254 712 345 678-> +254712345678
 *   00254712345678  -> +254712345678
 *
 * Anything it cannot confidently parse is returned trimmed and OTHERWISE
 * UNCHANGED rather than mangled into a plausible-looking wrong number. A
 * number that looks wrong gets questioned; a number that is silently wrong
 * gets dialled.
 */
export function normalizePhone(input: string | null | undefined): string {
  if (input == null) return ""
  const raw = input.trim()
  if (!raw) return ""

  const d = raw.replace(/[^0-9]/g, "")
  if (!d) return raw

  if (d.length === 12 && d.startsWith("254")) return `+${d}`
  if (d.length === 10 && d.startsWith("0")) return `+254${d.slice(1)}`
  if (d.length === 9) return `+254${d}`
  if (d.length === 14 && d.startsWith("00254")) return `+${d.slice(2)}`

  return raw
}

/** True when the value is a fully normalised Kenyan mobile number. */
export function isValidKenyanPhone(input: string | null | undefined): boolean {
  return /^\+254[17]\d{8}$/.test(normalizePhone(input))
}

/**
 * True for any plausible phone number we are willing to store.
 *
 * THIS, not isValidKenyanPhone, is what forms and imports should gate on.
 * Production carries 64 leads (about 2%) on non-Kenyan numbers — Tanzania,
 * Uganda, South Sudan, DRC, Zambia, Djibouti, China, Qatar, Australia,
 * Singapore — which is exactly what a Mombasa-corridor logistics business
 * should expect. Requiring +254 would refuse a Tanzanian transporter's number
 * and silently drop those rows on import.
 *
 * Kenyan input is still normalised to +254XXXXXXXXX; anything else is accepted
 * as typed provided it looks like an international number.
 */
export function isValidPhone(input: string | null | undefined): boolean {
  const n = normalizePhone(input)
  if (!n) return false
  if (isValidKenyanPhone(n)) return true
  // International: a leading + and 8-15 digits, per E.164.
  return /^\+\d{8,15}$/.test(n.replace(/[\s-]/g, ""))
}

/**
 * Display form: +254 712 345 678. Storage never changes — this is presentation
 * only, so never feed the result back into a query or a duplicate check.
 */
export function formatPhone(input: string | null | undefined): string {
  const n = normalizePhone(input)
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(n)
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : (input ?? "")
}

/** `tel:` href, which wants the compact form. */
export function telHref(input: string | null | undefined): string {
  return `tel:${normalizePhone(input)}`
}
