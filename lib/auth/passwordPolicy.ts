/**
 * The password policy. Deliberately NOT server-only — the form needs it too.
 *
 * WHY THIS IS SPLIT FROM tempPassword.ts
 * --------------------------------------
 * `lib/auth/tempPassword.ts` carries `import "server-only"` because it holds
 * the temporary-password GENERATOR, which must never reach the browser. When
 * `SetPasswordForm` (a client component) imported the minimum length from
 * there, the build failed — the guard working exactly as intended.
 *
 * The right split is by secrecy, not by subject. The policy is not a secret:
 * every user is told it, in the form. The generator is.
 *
 * Both live here and in Supabase → Authentication → Policies, and they have to
 * agree. Enforcing it here as well means users get "at least 8 characters, with
 * letters and numbers" instead of a raw Supabase error.
 */

/** Kelvin's decision, 2026-09-22 (§3 item 2). Matches Supabase's own default. */
export const PASSWORD_MIN_LENGTH = 8

/** Returns a human sentence describing the first failure, or null if it passes. */
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  }
  if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter."
  if (!/[0-9]/.test(password)) return "Password must contain at least one digit."
  return null
}
