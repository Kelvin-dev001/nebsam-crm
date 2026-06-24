import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

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

  // Refresh session — required by @supabase/ssr
  const { data: { session } } = await supabase.auth.getSession()

  const path = request.nextUrl.pathname

  // Always allow API routes and static assets (handled by matcher)
  if (path.startsWith("/api")) return response

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (!session) {
    if (path === "/login") return response
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", path)
    return NextResponse.redirect(loginUrl)
  }

  // ── Authenticated ─────────────────────────────────────────────────────────
  const role = (session.user.user_metadata?.role as string | undefined) ?? "telemarketer"

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
