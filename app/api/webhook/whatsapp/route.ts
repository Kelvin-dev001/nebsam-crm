import { NextRequest, NextResponse } from "next/server"

// Stub — full implementation in Sprint 9
export async function POST(request: NextRequest) {
  const body = await request.json()
  console.log("Webhook received:", body)
  return NextResponse.json({ received: true }, { status: 200 })
}
