import "server-only"

import { randomInt } from "crypto"

/**
 * Generates the one-time password an admin hands to a new user (U-D1, U-D2).
 *
 * `crypto.randomInt` — NEVER `Math.random`, which is not a CSPRNG and would
 * make these passwords predictable from one another.
 *
 * The alphabet omits characters that are easy to confuse when someone reads a
 * password off a screen and types it into a phone: zero/capital-O/lower-o, and
 * one/lower-L/capital-I. These get dictated over the phone and retyped by hand,
 * so an ambiguous glyph costs a support call.
 *
 * HANDLING RULES (§5.1). The generated value:
 *   • is returned in exactly ONE http response body,
 *   • is shown in exactly ONE dialog, which cannot be reopened,
 *   • is never logged, never written to the database, never put in the audit
 *     table, never placed in a toast or a URL.
 * If it is lost, the admin issues a new one. There is no way to look it up,
 * deliberately.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ" // no I, no O
const LOWER = "abcdefghijkmnpqrstuvwxyz" // no l, no o
const DIGIT = "23456789" //                 no 0, no 1
const ALL = UPPER + LOWER + DIGIT

const LENGTH = 12

/** One character, uniformly chosen. `randomInt` is rejection-sampled, so no modulo bias. */
const pick = (set: string) => set[randomInt(set.length)]

export function generateTempPassword(): string {
  // Guarantee one of each class so the result always satisfies a
  // "letters and digits" policy, then fill the rest from the full alphabet.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)]
  while (chars.length < LENGTH) chars.push(pick(ALL))

  // Fisher-Yates, so the guaranteed characters are not always in positions 0-2.
  // Without this the first three characters would leak their character class.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join("")
}

// The policy lives in ./passwordPolicy — NOT here — because the form needs it
// and this module is server-only. Re-exported so server callers have one import.
export { PASSWORD_MIN_LENGTH, checkPasswordPolicy } from "./passwordPolicy"
