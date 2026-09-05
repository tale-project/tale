import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import { transactSerializable } from '@tale/shared/db/serializable';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization, twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { Sql } from 'postgres';

import {
  assertValidOrgSlug,
  classifyOrgSlugUpdate,
  ORG_SLUG_IMMUTABLE_MESSAGE,
} from '../../lib/shared/constants/org-slug.ts';
import { isReservedOrgSlug } from '../../lib/shared/constants/reserved-org-slugs.ts';
import { DEFAULT_TRUSTED_PROXIES } from '../../lib/shared/schemas/governance.ts';
import { organizationNameSchema } from '../../lib/shared/schemas/organizations.ts';
import { sessionIdleWindowSeconds } from '../../lib/shared/session-idle.ts';
import { getString, isRecord } from '../../lib/utils/type-utils.ts';
import { getClientIp } from '../core/lib/utils/client_ip.ts';
import { logJoinedOrganization } from '../domains/audit_logs/service.ts';
import {
  clearOnSuccess,
  getLockState,
  recordBlocked,
  recordFailure,
} from '../domains/login_attempts/service.ts';
import {
  anchorTwoFactorGraceOnSignIn,
  getTwoFactorLockState,
  recordTwoFactorFailure,
  recordTwoFactorLifecycleEvent,
  recordTwoFactorSuccess,
  type TwoFactorLifecycleAction,
} from '../domains/two_factor/service.ts';
import { addJobInTx } from '../jobs/enqueue.ts';
import { readGovernancePolicy } from '../lib/org-config.ts';
import { checkIpRateLimit, RateLimitExceededError } from '../lib/rate-limit.ts';
import { ac, orgRoles } from './access.ts';

/**
 * Better Auth on Postgres — the 0.5 replacement for the Convex Better Auth
 * component, at 0.4 parity: email+password with the login-throttle gate
 * (per-IP flood guard + per-account exponential lockout), the organization
 * plugin (teams, access control, slug/name hooks, scaffold-on-create), and
 * the apiKey / twoFactor / passkey plugins. Differences from 0.4, tracked in
 * ../MIGRATION.md:
 *  - the Convex JWT/JWKS plugin is gone (same-process sessions; the sandbox
 *    port decides whether an equivalent returns);
 *  - member/team mirror resyncs are gone (mirrors died — see membership.ts);
 *  - the 2FA enforcement hooks (grace windows, verify-endpoint lockout) land
 *    with the two_factor domain;
 *  - `afterCreateOrganization` provisioning of automations/starter content
 *    lands with the provisioning domain.
 */
export interface AuthConfig {
  databaseUrl: string;
  secret: string;
  /** Public origin auth cookies/callbacks bind to, e.g. https://localhost. */
  baseUrl: string;
  /** App query lane for hooks (throttle state, audit chain, jobs). */
  sql: Sql;
}

const SIGN_IN_EMAIL_PATH = '/sign-in/email';

/**
 * The second-factor LIFECYCLE endpoints. Every one of them audits on success
 * — the 0.4 posture (#1508), carried by the deleted `two_factor/auth_hooks.ts`
 * whose lockout half this file already re-implements. These are
 * account-takeover-relevant: an attacker who registers their own passkey and
 * turns TOTP off must not be able to do it without leaving a trail.
 */
const TWO_FACTOR_ENABLE_PATH = '/two-factor/enable';
const TWO_FACTOR_DISABLE_PATH = '/two-factor/disable';
const TWO_FACTOR_BACKUP_CODES_PATH = '/two-factor/generate-backup-codes';
const PASSKEY_REGISTER_PATH = '/passkey/verify-registration';
const PASSKEY_DELETE_PATH = '/passkey/delete-passkey';
const PASSKEY_AUTHENTICATE_PATH = '/passkey/verify-authentication';

/** The user on a Better Auth middleware session payload (`context.session`
 * or the freshly issued `context.newSession`), or null. */
function sessionPayloadUser(
  payload: unknown,
): { id: string; email?: string } | null {
  if (!isRecord(payload)) return null;
  const user = payload.user;
  if (!isRecord(user) || typeof user.id !== 'string') return null;
  const email = typeof user.email === 'string' ? user.email : undefined;
  return { id: user.id, ...(email !== undefined ? { email } : {}) };
}

// Random delay (ms) added to lockout responses to fuzz the timing channel
// between "wrong password" (bcrypt, ~100ms) and "locked" (a single read).
const LOCKOUT_JITTER_MAX_MS = 200;

function bodyEmail(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const email = getString(body, 'email');
  return email ? email.toLowerCase() : null;
}

async function jitterDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * LOCKOUT_JITTER_MAX_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trusted-proxy list for X-Forwarded-For resolution: the deployment-level
 * `default` config tree's login policy, with built-in defaults. (0.4 read
 * the same policy through the legacy `default` org's configCache row.)
 */
export async function loadTrustedProxies(): Promise<string[]> {
  const policy = await readGovernancePolicy('default', 'login_policy');
  return policy && policy.trustedProxies.length > 0
    ? policy.trustedProxies
    : [...DEFAULT_TRUSTED_PROXIES];
}

/**
 * Schema-only plugin: adds the `suffix` column to the apiKey plugin's model
 * so the after-hook below can persist the trailing plaintext chars (the
 * upstream plugin stores only `start`; the table renders `start … suffix`).
 */
const apiKeySuffixPlugin = {
  id: 'tale-apikey-suffix',
  schema: {
    apikey: {
      fields: {
        suffix: { type: 'string', required: false, input: false },
      },
    },
  },
} satisfies BetterAuthPlugin;

/**
 * Per-API-key rate limit. Better Auth's apiKey plugin interprets `timeWindow`
 * in MILLISECONDS — it resets the per-key counter whenever
 * `now - lastRequest > timeWindow` (see `evaluateRateLimit` in
 * `@better-auth/api-key`). A bare `60` therefore means a 60-MILLISECOND
 * window: any two requests more than 60ms apart reset the counter, so the
 * limit never accumulates and API keys are effectively unthrottled. 60_000 is
 * the intended 60-second window; the value is persisted per key as
 * `apikey.rateLimitTimeWindow` at creation time.
 */
export const API_KEY_RATE_LIMIT = {
  enabled: true,
  /** 60 seconds, expressed in milliseconds (Better Auth's unit). */
  timeWindow: 60_000,
  maxRequests: 100,
} as const;

export function createAuth(config: AuthConfig) {
  const siteUrl = config.baseUrl;

  // Fail fast if a non-loopback hostname is served over HTTP — the backend
  // must never silently downgrade to insecure cookies (mirrors 0.4).
  {
    const parsed = new URL(siteUrl);
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
      parsed.hostname,
    );
    if (parsed.protocol === 'http:' && !isLoopback) {
      throw new Error(
        `SITE_URL must use HTTPS for non-loopback hostnames (got ${siteUrl}). ` +
          `Set SITE_URL=https://your-domain or run behind a TLS-terminating ` +
          `proxy with TLS_MODE=external.`,
      );
    }
  }
  const isHttps = siteUrl.startsWith('https://');
  const sql = config.sql;

  /** The 2FA verify endpoints the lockout counter guards. */
  const TWO_FACTOR_VERIFY_PATHS = new Set([
    '/two-factor/verify-totp',
    '/two-factor/verify-backup-code',
  ]);
  /** Resolve the pending user for a verify call: an authenticated session,
   * the just-issued session, or the 2FA verification cookie. */
  // oxlint-disable-next-line typescript/no-explicit-any -- better-auth middleware generics are unstable across minors
  const resolveTwoFactorUserId = async (mw: any): Promise<string | null> => {
    try {
      const existing = mw.context.session;
      if (isRecord(existing) && isRecord(existing.user)) {
        const id = existing.user.id;
        if (typeof id === 'string') return id;
      }
      const fresh = mw.context.newSession;
      if (isRecord(fresh) && isRecord(fresh.user)) {
        const id = fresh.user.id;
        if (typeof id === 'string') return id;
      }
      const cookieCfg = mw.context.createAuthCookie('two_factor');
      const signed = await mw.getSignedCookie(
        cookieCfg.name,
        mw.context.secret,
      );
      if (!signed) return null;
      const verification =
        await mw.context.internalAdapter.findVerificationValue(signed);
      if (!verification) return null;
      return typeof verification.value === 'string' ? verification.value : null;
    } catch (error) {
      console.warn('[two-factor] user resolution failed:', error);
      return null;
    }
  };

  /**
   * The successful second-factor lifecycle event on this request, or null.
   * Success detection is 0.4's, endpoint by endpoint: `/two-factor/enable`
   * only answers `{ totpURI, backupCodes }` when it worked and regeneration
   * only answers `{ backupCodes }`, while disable / passkey add / remove park
   * an `APIError` on `context.returned` when they fail. Passkey sign-in is
   * read off the freshly issued session, exactly like `login_success` on the
   * password path — a passkey FAILURE is challenge-based and attributable to
   * no user, so there is nothing to log.
   */
  const resolveTwoFactorLifecycle = (
    // oxlint-disable-next-line typescript/no-explicit-any -- better-auth middleware generics are unstable across minors
    mw: any,
  ): {
    userId: string;
    action: TwoFactorLifecycleAction;
    email?: string;
    metadata?: Record<string, unknown>;
  } | null => {
    const returned: unknown = mw.context.returned;
    if (returned instanceof APIError) return null;

    if (mw.path === PASSKEY_AUTHENTICATE_PATH) {
      const signedIn = sessionPayloadUser(mw.context.newSession);
      if (signedIn === null) return null;
      return {
        userId: signedIn.id,
        action: 'passkey_sign_in',
        ...(signedIn.email !== undefined ? { email: signedIn.email } : {}),
      };
    }

    // Every remaining endpoint requires an active session, so the actor is
    // the caller themselves; without one there is nothing to attribute.
    const actor = sessionPayloadUser(mw.context.session);
    if (actor === null) return null;
    const base = {
      userId: actor.id,
      ...(actor.email !== undefined ? { email: actor.email } : {}),
    };

    if (mw.path === TWO_FACTOR_ENABLE_PATH) {
      return isRecord(returned) && 'totpURI' in returned
        ? { ...base, action: '2fa_enrolled' }
        : null;
    }
    if (mw.path === TWO_FACTOR_BACKUP_CODES_PATH) {
      return isRecord(returned) && 'backupCodes' in returned
        ? {
            ...base,
            action: '2fa_enrolled',
            metadata: { backupCodesRegenerated: true },
          }
        : null;
    }
    if (mw.path === TWO_FACTOR_DISABLE_PATH) {
      return { ...base, action: '2fa_disabled' };
    }
    if (mw.path === PASSKEY_REGISTER_PATH) {
      return { ...base, action: 'passkey_added' };
    }
    if (mw.path === PASSKEY_DELETE_PATH) {
      return { ...base, action: 'passkey_removed' };
    }
    return null;
  };

  return betterAuth({
    database: new pg.Pool({ connectionString: config.databaseUrl, max: 5 }),
    secret: config.secret,
    baseURL: siteUrl,
    basePath: '/api/auth',
    trustedOrigins: [new URL(siteUrl).origin],
    // Pinned off regardless of upstream default changes.
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      cookiePrefix: 'better-auth',
      // __Secure- prefix is added automatically when true.
      useSecureCookies: isHttps,
    },
    // Our before-hook owns ALL sign-in throttling (per-IP flood guard via
    // app.rate_limits + per-account exponential lockout via
    // app.login_attempts); the built-in limiter would stack an opaque
    // fixed-window on top with an in-memory store.
    rateLimit: { enabled: false },
    user: {
      additionalFields: {
        // Last org the user signed in to — persists across logout/login,
        // unlike session.activeOrganizationId. Written by recordOrgSwitch.
        lastActiveOrganizationId: {
          type: 'string',
          required: false,
          input: false,
        } as const,
      },
    },
    session: {
      // Sliding idle window when SESSION_IDLE_TIMEOUT_MINUTES is set; else
      // default lifetime with updateAge tightened so `updatedAt` tracks
      // activity for the per-org idle-revocation sweep.
      ...sessionIdleWindowSeconds(),
      additionalFields: {
        trustedRole: {
          type: 'string' as const,
          required: false,
        },
        trustedTeams: {
          type: 'string' as const,
          required: false,
        },
      },
    },
    hooks: {
      // Pre-flight gate: reject sign-ins over the per-IP flood limit OR
      // against a locked account, surfacing the MAX retry-after of the two.
      before: createAuthMiddleware(async (mw) => {
        // 2FA verify lockout: a caller who knows the password must not
        // brute-force the ~10^6 TOTP space — the counter mirrors the
        // password lockout, keyed by the pending user's id.
        if (TWO_FACTOR_VERIFY_PATHS.has(mw.path)) {
          const userId = await resolveTwoFactorUserId(mw);
          if (userId) {
            const { lockedUntil } = await getTwoFactorLockState(sql, userId);
            if (lockedUntil !== null && lockedUntil > Date.now()) {
              await jitterDelay();
              throw new APIError('TOO_MANY_REQUESTS', {
                message: 'Invalid two-factor code',
                retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000),
              });
            }
          }
          return;
        }
        if (mw.path !== SIGN_IN_EMAIL_PATH) {
          return;
        }
        const email = bodyEmail(mw.body);
        const trusted = await loadTrustedProxies();
        const ip = mw.request
          ? getClientIp(mw.request.headers, trusted)
          : 'unknown';

        let lockoutMs = 0;
        if (email) {
          const { lockedUntil } = await getLockState(sql, email);
          if (lockedUntil !== null && lockedUntil > Date.now()) {
            lockoutMs = lockedUntil - Date.now();
          }
        }

        let ipLimitMs = 0;
        try {
          await checkIpRateLimit(sql, 'security:login-ip', ip);
        } catch (error) {
          if (error instanceof RateLimitExceededError) {
            ipLimitMs = error.retryAfter;
          } else {
            throw error;
          }
        }

        const retryAfterMs = Math.max(lockoutMs, ipLimitMs);
        if (retryAfterMs > 0) {
          // Better Auth skips after-hooks when a before-hook throws, so the
          // coalesced block-counter write happens HERE.
          if (email) {
            await transactSerializable(sql, (tx) =>
              recordBlocked(tx, { email, ip }),
            );
          }
          await jitterDelay();
          throw new APIError('TOO_MANY_REQUESTS', {
            message: 'Invalid credentials',
            retryAfter: Math.ceil(retryAfterMs / 1000),
          });
        }
      }),

      // Post-flight: classify the sign-in result into the failure counter,
      // and persist the api-key suffix on creation.
      after: createAuthMiddleware(async (mw) => {
        const trusted = await loadTrustedProxies();
        const ip = mw.request
          ? getClientIp(mw.request.headers, trusted)
          : undefined;
        const userAgent = mw.request?.headers.get('user-agent') ?? undefined;

        if (mw.path === SIGN_IN_EMAIL_PATH) {
          const email = bodyEmail(mw.body);
          if (email) {
            const returned = mw.context.returned;
            // Anything reaching here made it to the password check — a
            // before-hook 429 never runs after-hooks.
            const failed =
              returned instanceof APIError || !mw.context.newSession;
            await transactSerializable(sql, (tx) =>
              failed
                ? recordFailure(tx, {
                    email,
                    ...(ip !== undefined ? { ip } : {}),
                    ...(userAgent !== undefined ? { userAgent } : {}),
                  }).then(() => undefined)
                : clearOnSuccess(tx, {
                    email,
                    ...(ip !== undefined ? { ip } : {}),
                    ...(userAgent !== undefined ? { userAgent } : {}),
                  }),
            );
          }
          // Org 2FA enforcement: an enforced policy either starts the grace
          // clock (session kept — the enrolment wall needs it) or, past
          // grace, tells the client to route to enrolment. The session is
          // deliberately KEPT even when blocked: /two-factor/enable
          // requires it (the 0.4 posture).
          if (!(mw.context.returned instanceof APIError)) {
            const sessionUser = isRecord(mw.context.newSession)
              ? mw.context.newSession.user
              : null;
            const sessionUserId =
              isRecord(sessionUser) && typeof sessionUser.id === 'string'
                ? sessionUser.id
                : null;
            if (sessionUserId !== null) {
              const enforcement = await anchorTwoFactorGraceOnSignIn(
                sql,
                sessionUserId,
              );
              if (enforcement.decision === 'blocked') {
                return mw.json({
                  twoFactorRedirect: true,
                  enrollRequired: true,
                });
              }
            }
          }
        }

        // 2FA verify accounting: a failed code bumps the lockout counter,
        // a success clears it.
        if (TWO_FACTOR_VERIFY_PATHS.has(mw.path)) {
          const userId = await resolveTwoFactorUserId(mw);
          if (userId) {
            const returned = mw.context.returned;
            const failed =
              returned instanceof APIError ||
              (!mw.context.newSession && !isRecord(returned));
            if (failed) {
              await recordTwoFactorFailure(sql, {
                userId,
                method: mw.path.endsWith('verify-backup-code')
                  ? 'backup_code'
                  : 'totp',
                ...(ip !== undefined ? { ip } : {}),
                ...(userAgent !== undefined ? { userAgent } : {}),
              });
            } else {
              await recordTwoFactorSuccess(sql, userId);
            }
          }
        }

        // Second-factor lifecycle audit: 2FA enable / disable / backup-code
        // regeneration and passkey add / remove / sign-in. Non-fatal — the
        // state change already happened inside Better Auth's own adapter, so
        // refusing the response here would leave the user with a passkey
        // registered and an error on screen. A failed write is LOUD instead.
        const lifecycle = resolveTwoFactorLifecycle(mw);
        if (lifecycle !== null) {
          try {
            await recordTwoFactorLifecycleEvent(sql, {
              userId: lifecycle.userId,
              action: lifecycle.action,
              ...(lifecycle.email !== undefined
                ? { actorEmail: lifecycle.email }
                : {}),
              ...(ip !== undefined ? { ip } : {}),
              ...(userAgent !== undefined ? { userAgent } : {}),
              ...(lifecycle.metadata !== undefined
                ? { metadata: lifecycle.metadata }
                : {}),
            });
          } catch (error) {
            console.error(
              `[two-factor] failed to write the ${lifecycle.action} audit row`,
              error instanceof Error ? error.message : error,
            );
          }
        }

        // Persist the trailing plaintext chars of a freshly created API key
        // (`start … suffix` masking convention). Non-fatal on failure.
        if (mw.path === '/api-key/create') {
          const returned = mw.context.returned;
          const id = isRecord(returned) ? getString(returned, 'id') : null;
          const plaintext = isRecord(returned)
            ? getString(returned, 'key')
            : null;
          if (id && plaintext && plaintext.length > 4) {
            try {
              await sql`
                UPDATE "apikey" SET "suffix" = ${plaintext.slice(-4)}
                WHERE "id" = ${id}
              `;
            } catch (error) {
              console.warn(
                '[api-key/create] failed to persist suffix',
                error instanceof Error ? error.message : error,
              );
            }
          }
        }
        return undefined;
      }),
    },
    plugins: [
      organization({
        ac,
        roles: orgRoles,
        creatorRole: 'owner',
        teams: {
          enabled: true,
          allowRemovingAllTeams: true,
          defaultTeam: { enabled: false },
        },
        // Deletion is served by the app door only
        // (`POST /api/app/organizations/:id/delete`, one transaction with the
        // legal-hold gate, the audit row, the app-side cascade and the
        // config-tree cleanup). The plugin's own `/organization/delete`
        // would bypass all of that, so it answers 404.
        disableOrganizationDeletion: true,
        organizationHooks: {
          beforeCreateOrganization: async (data) => {
            const slug = data.organization.slug;
            if (!slug) {
              return;
            }
            // Normalize BEFORE the reservation and uniqueness checks so
            // case tricks can't bypass either.
            const normalizedSlug = slug.toLowerCase();
            try {
              assertValidOrgSlug(normalizedSlug);
            } catch (error) {
              throw new APIError('BAD_REQUEST', {
                message: error instanceof Error ? error.message : String(error),
              });
            }
            if (isReservedOrgSlug(normalizedSlug)) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is reserved by the platform.`,
              });
            }
            // The DB has no unique index on slug (Better Auth owns the
            // table), so enforce uniqueness here like 0.4 did.
            const existing = await sql<{ id: string }[]>`
              SELECT "id" FROM "organization"
              WHERE "slug" = ${normalizedSlug} LIMIT 1
            `;
            if (existing.length > 0) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is already taken.`,
              });
            }
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth's loose hook payload; projecting the normalized slug back (0.4 pattern)
            (data.organization as Record<string, unknown>).slug =
              normalizedSlug;
          },
          beforeUpdateOrganization: async (data) => {
            // Re-run the create-time guards on update so a rename can't
            // reach a reserved/duplicate slug or clear the name.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Better Auth's loose update payload (0.4 pattern)
            const orgPatch = data.organization as Record<string, unknown>;
            if (orgPatch.name !== undefined) {
              const parsedName = organizationNameSchema().safeParse(
                orgPatch.name,
              );
              if (!parsedName.success) {
                throw new APIError('BAD_REQUEST', {
                  message: 'Organization name is required.',
                });
              }
              orgPatch.name = parsedName.data;
            }
            const rawSlug = orgPatch.slug;
            if (typeof rawSlug !== 'string') {
              return;
            }
            const normalizedSlug = rawSlug.toLowerCase();
            try {
              assertValidOrgSlug(normalizedSlug);
            } catch (error) {
              throw new APIError('BAD_REQUEST', {
                message: error instanceof Error ? error.message : String(error),
              });
            }
            if (isReservedOrgSlug(normalizedSlug)) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is reserved by the platform.`,
              });
            }
            const selfOrgId = (
              data.member as { organizationId?: unknown } | undefined
            )?.organizationId;
            // The slug is the tenant key of every blob, the config tree and
            // the knowledge corpora; a rename would strand all of them. Once
            // set it is immutable — the current value may be re-sent, and a
            // slug-less org may receive its first. Fail closed when the org
            // being updated cannot be identified.
            const current =
              typeof selfOrgId === 'string'
                ? await sql<{ slug: string | null }[]>`
                    SELECT "slug" FROM "organization"
                    WHERE "id" = ${selfOrgId} LIMIT 1
                  `
                : [];
            if (
              current.length === 0 ||
              classifyOrgSlugUpdate(current[0]?.slug, normalizedSlug) ===
                'rename'
            ) {
              throw new APIError('BAD_REQUEST', {
                message: ORG_SLUG_IMMUTABLE_MESSAGE,
              });
            }
            const collision = await sql<{ id: string }[]>`
              SELECT "id" FROM "organization"
              WHERE "slug" = ${normalizedSlug} LIMIT 1
            `;
            const collisionIsSelf =
              typeof selfOrgId === 'string' && collision[0]?.id === selfOrgId;
            if (collision.length > 0 && !collisionIsSelf) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is already taken.`,
              });
            }
            orgPatch.slug = normalizedSlug;
          },
          afterCreateOrganization: async (data) => {
            const slug = data.organization.slug;
            if (slug) {
              // Scaffold is filesystem work → a worker job (idempotent
              // per-domain, singletonKey dedupes create-path retries). The
              // 0.4 follow-ups — configCache sync (dead in 0.5), default
              // automations, starter content — land with their domains.
              try {
                await addJobInTx(
                  sql,
                  'org.scaffold',
                  {
                    orgSlug: slug,
                    cleanFirst: true,
                  },
                  { singletonKey: `org-scaffold:${slug}` },
                );
              } catch (error) {
                console.error(
                  '[afterCreateOrganization] failed to enqueue scaffold',
                  error instanceof Error ? error.message : error,
                );
              }
            }
            // Member-POV audit row: the creator joined as owner. Non-fatal.
            try {
              await transactSerializable(sql, (tx) =>
                logJoinedOrganization(tx, {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                  userEmail: data.user.email,
                  userRole: data.member.role,
                }).then(() => undefined),
              );
            } catch (error) {
              console.error(
                '[afterCreateOrganization] failed to write joined_organization audit',
                error instanceof Error ? error.message : error,
              );
            }
          },
          afterAcceptInvitation: async (data) => {
            try {
              await transactSerializable(sql, (tx) =>
                logJoinedOrganization(tx, {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                  userEmail: data.user.email,
                  userRole: data.member.role,
                }).then(() => undefined),
              );
            } catch (error) {
              console.error(
                '[afterAcceptInvitation] failed to write joined_organization audit',
                error instanceof Error ? error.message : error,
              );
            }
          },
        },
      }),
      apiKey({
        defaultPrefix: 'tale',
        apiKeyHeaders: ['x-api-key'],
        enableSessionForAPIKeys: true,
        rateLimit: { ...API_KEY_RATE_LIMIT },
      }),
      apiKeySuffixPlugin,
      // TOTP two-factor. The verify-endpoint lockout + org enforcement hooks
      // land with the two_factor domain port.
      twoFactor({
        issuer: 'Tale',
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        skipVerificationOnEnable: false,
      }),
      // WebAuthn / passkeys as a phishing-resistant second factor.
      passkey({
        rpID: new URL(siteUrl).hostname,
        rpName: 'Tale',
        origin: new URL(siteUrl).origin,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
