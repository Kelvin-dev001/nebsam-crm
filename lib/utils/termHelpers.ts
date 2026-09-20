import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns"
import type { AcademicTerm } from "@/types/crm"

/**
 * School term calendar helpers — the client-side mirror of the SQL
 * `is_school_holiday()`, fed from the cached `academic_terms` list.
 *
 * THE CALENDAR IS USUALLY EMPTY. Real Kenyan term dates are entered by an admin
 * (Sprint D6); until then `academic_terms` has no rows, and that is a supported
 * state, not an error. Every function here returns a sane value on an empty
 * list, and `isCalendarConfigured()` is what the UI should test before showing
 * a term-aware control. Nothing in here may throw on empty input — a School Bus
 * page that crashes because nobody has typed the term dates yet is a far worse
 * failure than one that says "term calendar not configured".
 */

function toDate(value: string | Date): Date {
  return typeof value === "string" ? parseISO(value) : value
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function isCalendarConfigured(terms: AcademicTerm[]): boolean {
  return terms.length > 0
}

export function sortedTerms(terms: AcademicTerm[]): AcademicTerm[] {
  return [...terms].sort(
    (a, b) => toDate(a.start_date).getTime() - toDate(b.start_date).getTime(),
  )
}

/** The term containing `date`, or null (including when the calendar is empty). */
export function currentTerm(terms: AcademicTerm[], date: Date = new Date()): AcademicTerm | null {
  const d = startOfDay(date)
  return (
    sortedTerms(terms).find(
      (t) => d >= startOfDay(toDate(t.start_date)) && d <= startOfDay(toDate(t.end_date)),
    ) ?? null
  )
}

/** The next term starting strictly after `date`. */
export function nextTerm(terms: AcademicTerm[], date: Date = new Date()): AcademicTerm | null {
  const d = startOfDay(date)
  return sortedTerms(terms).find((t) => startOfDay(toDate(t.start_date)) > d) ?? null
}

/**
 * Mirrors the SQL is_school_holiday(). Returns false on an empty calendar, the
 * same as the database does — no calendar means no holiday hold, so RAG behaves
 * exactly as it does for every other department rather than silently
 * suppressing escalations.
 */
export function isSchoolHoliday(terms: AcademicTerm[], date: Date = new Date()): boolean {
  const d = startOfDay(date)
  return terms.some((t) => {
    if (!t.holiday_start || !t.holiday_end) return false
    return d >= startOfDay(toDate(t.holiday_start)) && d <= startOfDay(toDate(t.holiday_end))
  })
}

/** The holiday window containing `date`, for messages like "until 28 Aug". */
export function holidayWindow(
  terms: AcademicTerm[],
  date: Date = new Date(),
): { term: AcademicTerm; start: Date; end: Date } | null {
  const d = startOfDay(date)
  for (const t of sortedTerms(terms)) {
    if (!t.holiday_start || !t.holiday_end) continue
    const s = startOfDay(toDate(t.holiday_start))
    const e = startOfDay(toDate(t.holiday_end))
    if (d >= s && d <= e) return { term: t, start: s, end: e }
  }
  return null
}

export function daysToNextTerm(terms: AcademicTerm[], date: Date = new Date()): number | null {
  const n = nextTerm(terms, date)
  return n ? differenceInCalendarDays(toDate(n.start_date), startOfDay(date)) : null
}

/** Term start minus 14 days (Kelvin's decision, 2026-09-20). */
export function termBillingDueDate(term: AcademicTerm): Date {
  return addDays(toDate(term.start_date), -14)
}

/**
 * The warning a follow-up picker shows when a chosen date falls in a holiday.
 * Returns null when it does not, or when the calendar is not configured — in
 * which case the picker simply behaves normally.
 *
 * Never blocks the date: reps know their schools, and a transport manager may
 * well be reachable during the break.
 */
export function holidayFollowUpWarning(
  terms: AcademicTerm[],
  date: Date,
): { message: string; suggestion: Date; suggestionLabel: string } | null {
  const win = holidayWindow(terms, date)
  if (!win) return null

  const resume = nextTerm(terms, win.end)
  const suggestion = resume ? toDate(resume.start_date) : addDays(win.end, 1)
  const resumeLabel = resume ? resume.name : "the new term"

  return {
    message: `${win.term.name} holiday until ${format(win.end, "d MMM")} — the school will likely be closed.`,
    suggestion,
    suggestionLabel: `Move to the first day of ${resumeLabel}`,
  }
}
