"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { KeyRound, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SetPasswordForm } from "@/components/account/SetPasswordForm"
import { createClient } from "@/lib/supabase/client"
import { performSignOut } from "@/lib/auth/signOut"
import { getRole } from "@/lib/auth/getRole"

/**
 * /account/password — two variants of the same form.
 *
 *   ?first=1  the forced first sign-in. Full-screen, no navigation, no cancel,
 *             nothing to do but set a password or sign out.
 *   default   reached from the user menu. Sits inside the normal app shell.
 *
 * The forced variant covers the chrome with a fixed overlay rather than asking
 * AppShell to hide it. The middleware gate already redirects every other path
 * back here, so hiding the sidebar is about not offering a door that does not
 * open — §8.7 is explicit that this gate is UX, not a security boundary.
 */
export default function AccountPasswordPage() {
  const router = useRouter()
  const params = useSearchParams()
  const first = params.get("first") === "1"

  async function goHome() {
    // Hard navigation, not router.push: middleware has to re-evaluate with the
    // refreshed JWT. A client-side push would keep the old one and bounce
    // straight back here.
    const {
      data: { user },
    } = await createClient().auth.getUser()

    window.location.href = getRole(user) === "admin" ? "/admin" : "/dashboard"
  }

  const form = <SetPasswordForm first={first} onDone={goHome} />

  if (first) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-10"
        style={{ backgroundColor: "#0F1729" }}
      >
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Set your own password to continue</h1>
            <p className="mt-1 text-sm text-slate-400">
              You are signed in with a temporary password. Choose your own before you carry on.
            </p>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-xl">{form}</div>

          <button
            type="button"
            onClick={() => void performSignOut()}
            className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-bold text-slate-900">Change password</h1>
      <p className="mt-1 text-sm text-slate-500">
        You will stay signed in on this device. Other devices are not signed out.
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 p-5">{form}</div>

      <Button variant="ghost" className="mt-3 w-full" onClick={() => router.back()}>
        Cancel
      </Button>
    </div>
  )
}
