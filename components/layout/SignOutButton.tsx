"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"

// Always-visible sign-out control. Independent of any session lookup, so it
// works even when the header avatar menu is still resolving its session.
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const { setActiveTelemarketer } = useTelemarketerStore()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } finally {
      // Clear the persisted active telemarketer so a stale session can't linger.
      setActiveTelemarketer(null)
      router.push("/login")
      router.refresh()
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={signingOut}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        "text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-60",
        className
      )}
    >
      {signingOut ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4 shrink-0" />
      )}
      {signingOut ? "Signing out…" : "Sign Out"}
    </button>
  )
}
