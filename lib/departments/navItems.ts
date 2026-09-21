import {
  LayoutDashboard,
  Users,
  RefreshCcw,
  Inbox,
  PackageCheck,
  CalendarClock,
  type LucideIcon,
} from "lucide-react"
import type { PostSaleModel } from "@/types/crm"

/**
 * Navigation, driven by the department's post-sale model rather than a
 * hardcoded slug list.
 *
 * Each department chases something different after the sale, and showing a rep
 * a page that can never hold their data is worse than showing nothing:
 *
 *   annual_renewal  telematics   Renewals
 *   subscription    fuel         Contracts   (same page, renewal-shaped)
 *   consumption     e-seal       Reorders
 *   term_contract   school bus   Term Billing
 *   none                         (no post-sale item)
 *
 * Keep this the single source of truth — Sidebar, MobileNav and the middleware
 * route guard all read it, so a rep can never be shown a link they would then
 * be redirected away from.
 */

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const BASE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "My Leads", icon: Users },
  { href: "/backlog", label: "Backlog", icon: Inbox },
]

/** The post-sale nav item for a model, or null when there is nothing to chase. */
export function postSaleNavItem(model: PostSaleModel | null | undefined): NavItem | null {
  switch (model) {
    case "annual_renewal":
      return { href: "/renewals", label: "Renewals", icon: RefreshCcw }
    case "subscription":
      return { href: "/renewals", label: "Contracts", icon: RefreshCcw }
    case "consumption":
      return { href: "/reorders", label: "Reorders", icon: PackageCheck }
    case "term_contract":
      return { href: "/term-billing", label: "Term Billing", icon: CalendarClock }
    case "none":
      return null
    default:
      // No department resolved yet (first paint, or an admin viewing all).
      // Fall back to Renewals so telematics — the only department with reps
      // today — sees exactly the nav it has always had.
      return { href: "/renewals", label: "Renewals", icon: RefreshCcw }
  }
}

export function navItemsFor(model: PostSaleModel | null | undefined): NavItem[] {
  const postSale = postSaleNavItem(model)
  return postSale ? [...BASE_NAV, postSale] : [...BASE_NAV]
}

/**
 * Post-sale routes that belong to exactly one model. The middleware uses this
 * to redirect a rep who reaches a route their department does not have.
 */
export const POST_SALE_ROUTES: Record<string, PostSaleModel[]> = {
  "/renewals": ["annual_renewal", "subscription"],
  "/reorders": ["consumption"],
  "/term-billing": ["term_contract"],
  "/buses": ["term_contract"],
}
