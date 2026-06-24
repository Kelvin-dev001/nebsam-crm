"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import type { Telemarketer } from "@/types/crm"

async function fetchLinkedTelemarketer(userId: string): Promise<Telemarketer | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from("telemarketers")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single()
  return data as Telemarketer | null
}

export function AuthProvider() {
  const router = useRouter()
  const { activeTelemarketer, setActiveTelemarketer } = useTelemarketerStore()

  useEffect(() => {
    const supabase = createClient()

    // Guard: skip the store update if the telemarketer ID hasn't changed.
    // This prevents useEffect([activeTelemarketer]) hooks in child components
    // from re-firing when AuthProvider re-confirms the same telemarketer.
    function setIfChanged(tm: Telemarketer | null) {
      const currentId = useTelemarketerStore.getState().activeTelemarketer?.id
      if (tm?.id !== currentId) {
        setActiveTelemarketer(tm)
      }
    }

    async function syncSession() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setActiveTelemarketer(null)
        return
      }

      const role = session.user.user_metadata?.role as string | undefined

      if (role === "telemarketer") {
        const tm = await fetchLinkedTelemarketer(session.user.id)
        setIfChanged(tm)
      } else {
        // Admin — not linked to a specific telemarketer
        setIfChanged(null)
      }
    }

    syncSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          setActiveTelemarketer(null)
          router.push("/login")
          router.refresh()
          return
        }

        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          const role = session.user.user_metadata?.role as string | undefined
          if (role === "telemarketer") {
            const tm = await fetchLinkedTelemarketer(session.user.id)
            setIfChanged(tm)
          } else {
            setIfChanged(null)
          }
        }
      },
    )

    return () => subscription.unsubscribe()
  }, [setActiveTelemarketer]) // eslint-disable-line react-hooks/exhaustive-deps
  // router and activeTelemarketer intentionally excluded:
  // - router: including it re-runs on every navigation (stable in Next.js App Router)
  // - activeTelemarketer: setIfChanged reads it via getState() to avoid stale closure

  return null
}
