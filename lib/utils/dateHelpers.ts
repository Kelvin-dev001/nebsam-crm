import { format, formatDistanceToNow, addDays, differenceInDays, isPast } from "date-fns"

export function formatDate(date: string | Date): string {
  return format(new Date(date), "dd MMM yyyy")
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), "dd MMM yyyy, HH:mm")
}

export function formatRelative(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function addOneYear(date: string | Date): Date {
  return addDays(new Date(date), 365)
}

export function daysUntil(date: string | Date): number {
  return differenceInDays(new Date(date), new Date())
}

export function isOverdue(date: string | Date): boolean {
  return isPast(new Date(date))
}

export function getRenewalColorClass(daysUntil: number): string {
  if (daysUntil < 0) return "text-red-600"
  if (daysUntil <= 30) return "text-red-500"
  if (daysUntil <= 60) return "text-amber-500"
  return "text-green-600"
}
