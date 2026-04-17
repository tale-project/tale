import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-userId lockout counter for /two-factor/verify-totp and
 * /two-factor/verify-backup-code endpoints (issue #1507).
 *
 * Rationale: the TOTP verify request body has no email — it carries only
 * the 6-digit code and a 2FA verification cookie that resolves to a
 * userId. Keying the existing `loginAttempts` table (which is email-keyed)
 * here would require dereferencing user rows on every attempt. A parallel
 * table keeps semantics identical while making the userId lookup direct.
 *
 * Without this counter, a caller who already knows the password could
 * brute-force the ~10^6 TOTP space (or backup-code space) without any
 * per-account throttling — converting 2FA into a password-lockout bypass.
 */
export const twoFactorAttemptsTable = defineTable({
  userId: v.string(),
  consecutiveFailures: v.number(),
  lastFailureAt: v.number(),
  lockedUntil: v.union(v.number(), v.null()),
}).index('by_userId', ['userId']);
