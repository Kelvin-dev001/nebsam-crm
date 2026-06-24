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
  const { setActiveTelemarketer } = useTelemarketerStore()

  useEffect(() => {
    const supabase = createClient()

    async function syncSession() {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setActiveTelemarketer(null)
        return
      }

      const role = session.user.user_metadata?.role as string | undefined

      if (role === "telemarketer") {
        const tm = await fetchLinkedTelemarketer(session.user.id)
        setActiveTelemarketer(tm)
      } else {
        // Admin — not linked to a specific telemarketer
        setActiveTelemarketer(null)
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
            setActiveTelemarketer(tm)
          } else {
            setActiveTelemarketer(null)
          }
        }
      },
    )

    return () => subscription.unsubscribe()
  }, [router, setActiveTelemarketer])

  return null
}
