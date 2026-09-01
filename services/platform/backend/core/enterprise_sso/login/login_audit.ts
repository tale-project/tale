import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';

// Error messages carry Graph/AADSTS response bodies and stack fragments; cap the
// audited length so one row can't balloon (the chain hashes every field).
const MAX_AUDIT_ERROR_LEN = 500;

interface RecordSsoLoginFailureArgs {
  /**
   * The connection's org, once resolved. Undefined when the failure happened
   * before we knew which connection to use (bad state, unknown org) — audit
   * rows are per-org and hash-chained, so there is no org to attach them to and
   * we skip the write, leaving the `console.error` as the only trace.
   */
  organizationId: string | undefined;
  stage: 'authorize' | 'callback';
  errorMessage: string;
  /** The i18n key the user was bounced to, e.g. `sso.errors.serverError`. */
  errorKey?: string;
  /** Email the user was signing in with, when known (login hint / userinfo). */
  attemptedEmail?: string;
  providerId?: string;
}

/**
 * Write a durable `auth`/`failure` audit row for a failed SSO login so the
 * failure is visible beyond an ephemeral `console.error` (the callback catches
 * the error and redirects, so it never surfaces as a failed request). Reached
 * from the OIDC authorize/callback http actions' catch blocks.
 *
 * Best-effort: no-ops without a resolved org, and never throws — an audit-write
 * failure must not mask the real login error or break the redirect back to the
 * login page.
 */
export async function recordSsoLoginFailure(
  ctx: ActionCtx,
  args: RecordSsoLoginFailureArgs,
): Promise<void> {
  if (!args.organizationId) return;

  // Normalise an empty `?email=` hint to "no email" so it doesn't land as a
  // blank actor id / email on the row.
  const email = args.attemptedEmail || undefined;

  const metadata: Record<string, string> = { stage: args.stage };
  if (args.errorKey) metadata['errorKey'] = args.errorKey;
  if (args.providerId) metadata['providerId'] = args.providerId;

  try {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: args.organizationId,
        actorId: email ?? 'unknown',
        actorEmail: email,
        actorType: 'user',
        action: 'sso_login_failed',
        category: 'auth',
        resourceType: 'sso',
        resourceId: args.organizationId,
        status: 'failure',
        errorMessage: args.errorMessage.slice(0, MAX_AUDIT_ERROR_LEN),
        metadata,
      },
    );
  } catch (e) {
    console.error('[SSO] Failed to write login-failure audit log:', e);
  }
}
