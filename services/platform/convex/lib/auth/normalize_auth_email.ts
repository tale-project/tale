/**
 * Canonical email form for Better Auth user rows and lookups.
 * RFC 5321 treats the mailbox as case-insensitive; Convex `eq` is not.
 */
export function normalizeAuthEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** True when `email` is already stored in canonical form. */
export function isNormalizedAuthEmail(email: string): boolean {
  return email === normalizeAuthEmail(email);
}
