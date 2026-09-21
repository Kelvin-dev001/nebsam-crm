import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { POST_SALE_ROUTES } from "@/lib/departments/navItems"
import type { PostSaleModel } from "@/types/crm"

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Validate the token with the Auth server. getUser() actually verifies the
  // JWT (and refreshes it if possible); getSession() only reads the cookie and
  // will happily hand back an expired/stale session — which is what let a dead
  // session walk straight into the dashboard instead of being sent to /login.
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // Always allow API routes and static assets (handled by matcher)
  if (path.startsWith("/api")) return response

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (!user) {
    if (path === "/login") return response
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", path)
    return NextResponse.redirect(loginUrl)
  }

  // ── Authenticated ─────────────────────────────────────────────────────────
  const role = (user.user_metadata?.role as string | undefined) ?? "telemarketer"

  // Redirect away from login page
  if (path === "/login") {
    const dest = role === "admin" ? "/admin" : "/dashboard"
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Admin: redirect from /dashboard → /admin (admin's home is /admin)
  if (role === "admin" && path === "/dashboard") {
    return NextResponse.redirect(new URL("/admin", request.url))
  }

  // Telemarketer: block /admin access
  if (role !== "admin" && path.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // ── Post-sale route guard ─────────────────────────────────────────────────
  // A rep reaching a post-sale page their department does not have — /renewals
  // for an e-seal rep, /buses for anyone but school bus — goes to /dashboard.
  //
  // Driven by the department's post_sale_model rather than a hardcoded slug
  // list, so adding a fifth department needs no change here. Admins are global
  // and are never redirected.
  //
  // This is a second line of defence, not the primary one: the nav never offers
  // a rep a link they would be bounced from (lib/departments/navItems.ts). It
  // exists for typed URLs and stale bookmarks.
  const guardedRoute = Object.keys(POST_SALE_ROUTES).find(
    (route) => path === route || path.startsWith(route + "/"),
  )

  if (guardedRoute && role !== "admin") {
    const { data: rep } = await supabase
      .from("telemarketers")
      .select("departments(post_sale_model)")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle()

    const model = (
      rep as { departments?: { post_sale_model?: PostSaleModel } | null } | null
    )?.departments?.post_sale_model

    // Only redirect when the department is KNOWN and does not allow the route.
    // If the lookup returns nothing — an unlinked rep, or a database that has
    // not run migration 009 — fall through rather than locking someone out of
    // a page they have always been able to use.
    if (model && !POST_SALE_ROUTES[guardedRoute].includes(model)) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
