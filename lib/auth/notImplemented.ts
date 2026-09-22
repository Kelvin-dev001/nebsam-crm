import "server-only"

import { NextResponse } from "next/server"

/**
 * The body every U1 route stub returns once its guard has passed.
 *
 * The stubs exist before the logic on purpose. U1's acceptance criterion is
 * that every `/api/admin/users/*` route answers **401 to an anonymous caller
 * and 403 to a rep** — and the cheapest way to be sure of that is to ship the
 * guard first, with nothing behind it, and test it. A route whose guard is
 * added at the same time as its logic is a route whose guard was never tested
 * on its own.
 *
 * 501 rather than 404 so the difference between "this endpoint is planned" and
 * "you typed the URL wrong" stays visible while U2-U4b fill them in.
 */
export function notImplemented(sprint: string) {
  return NextResponse.json(
    { ok: false, error: `This endpoint is not built yet. It arrives in sprint ${sprint}.` },
    { status: 501 },
  )
}
