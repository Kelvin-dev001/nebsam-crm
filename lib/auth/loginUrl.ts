/**
 * The address staff are told to sign in at.
 *
 * Kelvin's decision, 2026-09-22 (§3 item 1): the current Vercel address. It is
 * here rather than inlined in the Add User dialog so that moving to a custom
 * domain — crm.nebsamdigital.com — is a one-line change plus a redeploy, not a
 * search through components.
 *
 * Prefers NEXT_PUBLIC_APP_URL when set, so the domain can be switched from
 * Vercel's environment settings without touching code at all.
 */
export const LOGIN_URL =
  (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://nebsam-crm.vercel.app") + "/login"

/**
 * The message an admin copies and pastes into WhatsApp when handing someone
 * their login. Plain text on purpose: it is going into a chat app, not an
 * email client, so no markup survives.
 *
 * The temporary password appears here and NOWHERE else — never logged, never
 * stored, never in the audit table (§5.1).
 */
export function loginDetailsMessage(opts: {
  fullName: string
  email: string
  tempPassword: string
}): string {
  const firstName = opts.fullName.trim().split(/\s+/)[0] || "there"
  return [
    `Hi ${firstName}, your Nebsam CRM login:`,
    ``,
    `Link: ${LOGIN_URL}`,
    `Email: ${opts.email}`,
    `Temporary password: ${opts.tempPassword}`,
    ``,
    `You'll be asked to set your own password when you first sign in.`,
  ].join("\n")
}
