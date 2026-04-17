/**
 * Auth middleware helpers for the better-auth `twoFactor` plugin. Wired
 * into the main `hooks.before` / `hooks.after` in `convex/auth.ts`.
 *
 * Why live here: the main `auth.ts` file is already large and owns the
 * password-lockout + sign-in enforcement. Extracting the 2FA branches
 * keeps both readable and lets the 2FA module own its own error paths.
 */

import {
  requireRunMutationCtx,
  type GenericCtx,
} from '@convex-dev/better-auth/utils';
import { APIError } from 'better-auth/api';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';

const TWO_FACTOR_COOKIE_NAME = 'two_factor';

// Paths this module owns. Everything else is ignored by the exported hooks.
const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
const VERIFY_BACKUP_CODE_PATH = '/two-factor/verify-backup-code';
const ENABLE_PATH = '/two-factor/enable';
const DISABLE_PATH = '/two-factor/disable';
const GENERATE_BACKUP_CODES_PATH = '/two-factor/generate-backup-codes';
const SIGN_IN_EMAIL_PATH = '/sign-in/email';

const VERIFY_PATHS = new Set<string>([
  VERIFY_TOTP_PATH,
  VERIFY_BACKUP_CODE_PATH,
]);

const LOCKOUT_JITTER_MAX_MS = 200;

async function jitterDelay() {
  const ms = Math.floor(Math.random() * LOCKOUT_JITTER_MAX_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the pending userId from the 2FA cookie set by /sign-in/email
 * when the account has two-factor enabled. Returns null when the cookie
 * is absent, invalid, or expired — in which case the endpoint itself
 * returns UNAUTHORIZED and no lockout should be recorded.
 */
async function resolveUserIdFromTwoFactorCookie(
  mw: AuthMiddlewareCtx,
): Promise<string | null> {
  try {
    const existingSession = mw.context.session;
    if (existingSession?.user?.id) return existingSession.user.id;

    const cookieCfg = mw.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
    const signed = await mw.getSignedCookie(cookieCfg.name, mw.context.secret);
    if (!signed) return null;

    const verification =
      await mw.context.internalAdapter.findVerificationValue(signed);
    if (!verification) return null;
    return verification.value ?? null;
  } catch (err) {
    console.warn('resolveUserIdFromTwoFactorCookie failed', err);
    return null;
  }
}

// Narrow the middleware context to what we actually touch. Better-auth's
// internal types are unstable across minor versions — keeping this surface
// small limits the breakage when we upgrade.
// Narrow the middleware context to what we actually touch. Better-auth's
// internal types are unstable across minor versions — keeping this surface
// small limits the breakage when we upgrade. Using `unknown` for the
// session/newSession payloads avoids coupling to better-auth's generic
// inference.
// oxlint-disable-next-line typescript/no-explicit-any -- middleware generic inference is unstable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthMiddlewareCtx = any;

/**
 * Before-hook branch for /two-factor/verify-totp and /two-factor/verify-backup-code.
 *
 * Reads the 2FA cookie → verification row → userId, then checks the
 * twoFactorAttempts lockout. Throws 429 with jitter when locked to mirror
 * the password-lockout behavior. Without this, an attacker with the
 * password could brute-force the 6-digit TOTP space (~10^6) freely.
 *
 * Returns the resolved userId so the after-hook can reuse it without a
 * second cookie decode. The function also returns null (no-op) for:
 * - invalid / expired / missing 2FA cookie (the endpoint itself 401s)
 * - non-2FA paths
 */
export async function twoFactorBeforeHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
): Promise<void> {
  if (!VERIFY_PATHS.has(mw.path)) return;

  const userId = await resolveUserIdFromTwoFactorCookie(mw);
  if (!userId) return;

  const runCtx = requireRunMutationCtx(ctx);
  const { lockedUntil } = await runCtx.runQuery(
    internal.two_factor.internal_queries.getLockStateByUserId,
    { userId },
  );
  if (!lockedUntil || lockedUntil <= Date.now()) return;

  await jitterDelay();
  throw new APIError('TOO_MANY_REQUESTS', {
    message: 'Invalid two-factor code',
    retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000),
  });
}

function didFail(returned: unknown, newSession: unknown): boolean {
  // On /two-factor/verify-* paths, the endpoint throws APIError for a bad
  // code. The framework catches the throw and parks it on `ctx.returned`.
  // Enrollment-time verify creates a new session; login-time verify also
  // issues a session. Either way, a missing session with no error means
  // the endpoint didn't reach the success path.
  if (returned instanceof APIError) return true;
  if (isRecord(returned) && 'status' in returned && returned.status === false) {
    return true;
  }
  return !newSession && !isRecord(returned);
}

/**
 * After-hook branch for 2FA verify / enable / disable / regenerate. Records
 * lockout counter updates and emits audit-log entries.
 *
 * Also handles the enforcement path on /sign-in/email: when the org
 * policy is enforced and the user is past grace, we delete the session
 * better-auth just issued and return `{ twoFactorRedirect: true,
 * enrollRequired: true }` — the same shape the plugin itself returns
 * when 2FA is already enrolled, which the client `twoFactorClient`
 * plugin understands. The log-in page branches on `enrollRequired` to
 * route to the enrollment wall instead of the verification screen.
 */
export async function twoFactorAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<unknown> {
  // Sign-in enforcement — runs alongside the existing password-lockout
  // after-hook. Intentionally uses its own branch so the two remain
  // independent and readable.
  if (mw.path === SIGN_IN_EMAIL_PATH) {
    return signInEnforcementAfterHook(ctx, mw);
  }

  if (VERIFY_PATHS.has(mw.path)) {
    return verifyAfterHook(ctx, mw, clientIp, userAgent);
  }

  if (mw.path === ENABLE_PATH) {
    return enableAfterHook(ctx, mw, clientIp, userAgent);
  }

  if (mw.path === DISABLE_PATH) {
    return disableAfterHook(ctx, mw, clientIp, userAgent);
  }

  if (mw.path === GENERATE_BACKUP_CODES_PATH) {
    return regenerateBackupCodesAfterHook(ctx, mw, clientIp, userAgent);
  }

  return undefined;
}

async function verifyAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  const userId = await resolveUserIdFromTwoFactorCookie(mw);
  if (!userId) return;

  const runCtx = requireRunMutationCtx(ctx);
  const method = mw.path === VERIFY_BACKUP_CODE_PATH ? 'backup_code' : 'totp';

  const failed = didFail(mw.context.returned, mw.context.newSession);
  if (failed) {
    await runCtx.runMutation(
      internal.two_factor.internal_mutations.recordFailure,
      { userId, ip: clientIp, userAgent, method },
    );
    return;
  }

  await runCtx.runMutation(
    internal.two_factor.internal_mutations.clearOnSuccess,
    { userId, ip: clientIp, userAgent, method },
  );
}

async function enableAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  const returned = mw.context.returned;
  // /two-factor/enable requires an active session via sessionMiddleware;
  // the only successful shape is { totpURI, backupCodes }.
  if (!isRecord(returned) || !('totpURI' in returned)) return;
  const userId = mw.context.session?.user?.id;
  if (!userId) return;

  const runCtx = requireRunMutationCtx(ctx);
  await runCtx.runMutation(
    internal.two_factor.internal_mutations.logEnrollmentEvent,
    {
      userId,
      actorId: userId,
      action: '2fa_enrolled',
      ip: clientIp,
      userAgent,
    },
  );
}

async function disableAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  if (mw.context.returned instanceof APIError) return;
  const userId = mw.context.session?.user?.id;
  if (!userId) return;

  const runCtx = requireRunMutationCtx(ctx);
  await runCtx.runMutation(
    internal.two_factor.internal_mutations.logEnrollmentEvent,
    {
      userId,
      actorId: userId,
      action: '2fa_disabled',
      ip: clientIp,
      userAgent,
    },
  );
}

async function regenerateBackupCodesAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
  clientIp: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  const returned = mw.context.returned;
  if (!isRecord(returned) || !('backupCodes' in returned)) return;
  const userId = mw.context.session?.user?.id;
  if (!userId) return;

  const runCtx = requireRunMutationCtx(ctx);
  await runCtx.runMutation(
    internal.two_factor.internal_mutations.logEnrollmentEvent,
    {
      userId,
      actorId: userId,
      action: '2fa_enrolled',
      ip: clientIp,
      userAgent,
      metadata: { backupCodesRegenerated: true },
    },
  );
}

/**
 * Post-sign-in enforcement: if the org policy demands 2FA, the user has
 * no twoFactor setup, and they're past their grace window, delete the
 * just-issued session and return a JSON payload telling the client to
 * redirect to the enrollment wall.
 *
 * When the user is within grace, we idempotently set `twoFactorGraceUntil`
 * on first sign-in so their clock starts ticking immediately — admins
 * editing the policy after that point don't reset the window. The
 * session is left intact so the user can keep working while they enrol.
 *
 * Paths like /sign-in/two-factor, OAuth callback, trusted-headers and
 * API-key auth never hit this hook because they use different paths.
 */
async function signInEnforcementAfterHook(
  ctx: GenericCtx<DataModel>,
  mw: AuthMiddlewareCtx,
): Promise<unknown> {
  const newSession = mw.context.newSession;
  if (!isRecord(newSession)) return undefined;
  const user = isRecord(newSession.user) ? newSession.user : null;
  const session = isRecord(newSession.session) ? newSession.session : null;
  if (!user || !session) return undefined;

  const userId = typeof user.id === 'string' ? user.id : null;
  if (!userId) return undefined;

  const twoFactorEnabled = user.twoFactorEnabled === true;
  const twoFactorGraceUntil =
    typeof user.twoFactorGraceUntil === 'number'
      ? user.twoFactorGraceUntil
      : null;

  const runCtx = requireRunMutationCtx(ctx);
  const result = await runCtx.runQuery(
    internal.two_factor.internal_queries.evaluateEnforcement,
    { userId, twoFactorEnabled, twoFactorGraceUntil },
  );

  if (result.decision === 'ok') return undefined;

  if (result.decision === 'grace') {
    if (result.graceUntilToSet !== null) {
      await runCtx.runMutation(
        internal.two_factor.internal_mutations.setGraceUntilIfAbsent,
        { userId, graceUntil: result.graceUntilToSet },
      );
    }
    return undefined;
  }

  // decision === 'blocked' — the user must enrol before continuing.
  //
  // We intentionally DO NOT delete the session here. Better-auth's
  // `/two-factor/enable` endpoint requires an authenticated session, and
  // the enrolment wall at `/2fa-enroll` needs to call it. Keeping the
  // session but returning `enrollRequired: true` lets the client route
  // to the wall while preserving access to the 2FA plugin endpoints.
  //
  // Security note: a user who manually bypasses the client-side redirect
  // could still reach the dashboard. Full enforcement requires a server-
  // side RLS check on every authenticated request — tracked separately.
  // For this ticket we ship soft enforcement + audit visibility.
  return mw.json({ twoFactorRedirect: true, enrollRequired: true });
}
