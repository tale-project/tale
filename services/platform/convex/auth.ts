import { apiKey } from '@better-auth/api-key';
import { passkey } from '@better-auth/passkey';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization, twoFactor } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from 'better-auth/plugins/organization/access';

import { assertValidOrgSlug } from '../lib/shared/constants/org-slug';
import { isReservedOrgSlug } from '../lib/shared/constants/reserved-org-slugs';
import { organizationNameSchema } from '../lib/shared/schemas/organizations';
import { sessionIdleWindowSeconds } from '../lib/shared/session-idle';
import { isRecord, getString } from '../lib/utils/type-utils';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import authConfig from './auth.config';
import authSchema from './betterAuth/schema';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { getClientIp, loadTrustedProxies } from './lib/utils/client_ip';
import {
  twoFactorAfterHook,
  twoFactorBeforeHook,
} from './two_factor/auth_hooks';

const siteUrl = process.env.SITE_URL || 'http://127.0.0.1:3000';

// Fail fast if a non-loopback hostname is served over HTTP. Mirrors the
// HTTPS guard in services/cli/.../docker-entrypoint.sh; kept here so the
// Convex backend never silently downgrades to insecure cookies when
// SITE_URL is misconfigured. NODE_ENV is unreliable inside the Convex
// runtime, so we use the SITE_URL hostname as the production signal.
{
  const parsed = new URL(siteUrl);
  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    parsed.hostname,
  );
  if (parsed.protocol === 'http:' && !isLoopback) {
    throw new Error(
      `SITE_URL must use HTTPS for non-loopback hostnames (got ${siteUrl}). ` +
        `Set SITE_URL=https://your-domain or run behind a TLS-terminating proxy ` +
        `with TLS_MODE=external.`,
    );
  }
}

// Define Better Auth Access Control (custom roles + permissions)
// Centralize table-keyed permissions used by RLS and the org plugin
// Only includes resources that exist in schema.ts
const platformResourceStatements = {
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  connectors: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  messageFeedback: ['read', 'write'],
} as const;

const platformStatements = {
  ...defaultStatements,
  ...platformResourceStatements,
} as const;

const ac = createAccessControl(platformStatements);

const admin = ac.newRole({
  ...adminAc.statements,

  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  connectors: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  messageFeedback: ['read', 'write'],
});

const developer = ac.newRole({
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  connectors: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read'],
  messageFeedback: ['read', 'write'],
});

const editor = ac.newRole({
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  // connectors/providers/onedrive/workflow: read only
  connectors: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read'],
  messageFeedback: ['read', 'write'],
  // No access to: settings, workflows (frontend menu restricted)
});

const member = ac.newRole({
  agents: ['read'],
  documents: ['read'],
  products: ['read'],
  projects: ['read'],
  contacts: ['read'],
  connectors: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read'],
  conversationMessages: ['read'],
  wfDefinitions: ['read'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read'],
  approvals: ['read'],
  websites: ['read'],
  auditLogs: ['read'],
  governancePolicies: ['read'],
  messageFeedback: ['read', 'write'],
  // No access to: settings, workflows (frontend menu restricted)
});

const disabled = ac.newRole({
  agents: [],
  documents: [],
  products: [],
  projects: [],
  contacts: [],
  connectors: [],
  onedriveSyncConfigs: [],
  conversations: [],
  conversationMessages: [],
  wfDefinitions: [], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: [],
  approvals: [],
  websites: [],
  auditLogs: [],
  governancePolicies: [],
  messageFeedback: [],
});

const owner = ac.newRole({
  ...ownerAc.statements,

  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  connectors: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  messageFeedback: ['read', 'write'],
});

export const platformRoles = {
  owner,
  admin,
  developer,
  editor,
  member,
  disabled,
} as const;
export type PlatformRoleName = keyof typeof platformRoles;

const orgRoles = {
  owner,
  admin,
  developer,
  editor,
  member,
  disabled,
} as const;

export type PlatformTable = keyof typeof platformResourceStatements;
export type PlatformAction = 'read' | 'write';

export function authorizeRls(
  role: string | undefined,
  table: PlatformTable,
  action: PlatformAction,
): boolean {
  const normalized = (role ?? 'member').toLowerCase();
  const key: PlatformRoleName =
    normalized === 'owner' ||
    normalized === 'admin' ||
    normalized === 'developer' ||
    normalized === 'editor' ||
    normalized === 'disabled'
      ? (normalized as PlatformRoleName)
      : 'member';
  const r = platformRoles[key];
  const req = { [table]: [action] } as Record<string, string[]>;
  const res = (
    r as {
      authorize: (
        req: Record<string, string[]>,
      ) => { success?: boolean } | undefined;
    }
  ).authorize(req);
  return !!res?.success;
}

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: {
      schema: authSchema,
    },
  },
);
const SIGN_IN_EMAIL_PATH = '/sign-in/email';
// Random delay (ms) added to lockout responses to fuzz the timing channel
// between "wrong password" (which runs bcrypt, ~100ms) and "locked"
// (which is a single DB read). Without this, an attacker could distinguish
// the two by latency alone.
const LOCKOUT_JITTER_MAX_MS = 200;

function bodyEmail(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const email = getString(body, 'email');
  return email ? email.toLowerCase() : null;
}

async function jitterDelay() {
  const ms = Math.floor(Math.random() * LOCKOUT_JITTER_MAX_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to get auth options (for createApi)
export const getAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Determine if we're running in HTTPS mode
  const isHttps = siteUrl.startsWith('https://');

  return {
    baseURL: siteUrl,
    trustedOrigins: [new URL(siteUrl).origin],
    database: authComponent.adapter(ctx),
    // Explicitly opt out of Better Auth's anonymous usage telemetry. It ships
    // disabled by default today, but pinning it here keeps it off regardless
    // of any future change to that default.
    // See https://better-auth.com/docs/reference/telemetry
    telemetry: {
      enabled: false,
    },
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      // Better Auth automatically adds __Secure- prefix when useSecureCookies is true
      // So we just use 'better-auth' as the base prefix
      cookiePrefix: 'better-auth',
      // Force secure cookies when running over HTTPS (this adds __Secure- prefix automatically)
      useSecureCookies: isHttps,
    },
    // Disable Better Auth's built-in rate limiting — our `hooks.before`
    // gate owns all sign-in throttling (per-IP flood guard via
    // @convex-dev/rate-limiter + per-account exponential lockout via the
    // loginAttempts table). Leaving the built-in enabled would stack an
    // opaque fixed-window limiter on top of our gate in production, with
    // Better Auth's in-memory store that doesn't survive Convex's
    // stateless runtime.
    rateLimit: {
      enabled: false,
    },
    user: {
      additionalFields: {
        // Per-user idempotent grace-period anchor for the org `enforceTwoFactor`
        // policy (issue #1507). Set ONCE on the first sign-in where enforcement
        // applies to a credential user who isn't enrolled. Admin reset clears it
        // so the user gets a fresh window. Never recomputed — immune to policy
        // edits flipping unrelated fields.
        twoFactorGraceUntil: {
          type: 'number',
          required: false,
          input: false,
        } as const,
        // Last organization the user signed in to — persists across
        // logout/login, unlike session.activeOrganizationId which dies with
        // the session. Written by recordOrgSwitch whenever the user signs
        // in to an org.
        lastActiveOrganizationId: {
          type: 'string',
          required: false,
          input: false,
        } as const,
      },
    },
    session: {
      // Server-side session idle timeout (#1502): when
      // SESSION_IDLE_TIMEOUT_MINUTES is set, this makes the session a sliding
      // window that expires after that many minutes of inactivity (Better Auth
      // refreshes the expiry on activity and rejects it once idle past the
      // window). When unset, the lifetime stays at Better Auth's default but
      // `updateAge` tightens to 60s so `session.updatedAt` tracks activity —
      // the per-org idle-revocation sweep
      // (`governance/session_idle_enforcement.ts`) keys off it.
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
      // Pre-flight gate: reject sign-in attempts that are over the per-IP
      // flood limit OR against a currently locked account. Returns the
      // MAX retry-after of the two so the user sees the true unlock time
      // (the IP window is short — 1 minute — and would otherwise hide a
      // longer account lockout).
      before: createAuthMiddleware(async (mw) => {
        // 2FA verify endpoints need their own userId-keyed lockout. Without
        // this, a caller with the password could brute-force the 6-digit
        // TOTP space freely — the 2FA request body has no email, so the
        // email-keyed gate below can't cover it.
        await twoFactorBeforeHook(ctx, mw);

        if (mw.path !== SIGN_IN_EMAIL_PATH) return;

        const email = bodyEmail(mw.body);
        const runCtx = requireRunMutationCtx(ctx);
        const trusted = await loadTrustedProxies(runCtx);
        const ip = mw.request
          ? getClientIp(mw.request.headers, trusted)
          : 'unknown';

        let lockoutMs = 0;
        if (email) {
          const { lockedUntil } = await runCtx.runQuery(
            internal.login_attempts.internal_queries.getLockState,
            { email },
          );
          if (lockedUntil && lockedUntil > Date.now()) {
            lockoutMs = lockedUntil - Date.now();
          }
        }

        let ipLimitMs = 0;
        try {
          await checkIpRateLimit(runCtx, 'security:login-ip', ip);
        } catch (err) {
          if (err instanceof RateLimitExceededError) {
            ipLimitMs = err.retryAfter;
          } else {
            throw err;
          }
        }

        const retryAfterMs = Math.max(lockoutMs, ipLimitMs);
        if (retryAfterMs > 0) {
          // Record into the coalesced block-counter BEFORE throwing. When a
          // before-hook throws, Better Auth bails out of `runAfterHooks`
          // entirely (see node_modules/better-auth/dist/api/to-auth-endpoints.mjs),
          // so the after-hook is the wrong place for this.
          if (email) {
            await runCtx.runMutation(
              internal.login_attempts.internal_mutations.recordBlocked,
              { email, ip },
            );
          }
          await jitterDelay();
          throw new APIError('TOO_MANY_REQUESTS', {
            message: 'Invalid credentials',
            retryAfter: Math.ceil(retryAfterMs / 1000),
          });
        }
      }),

      // Post-flight: classify the result and update the per-account
      // failure counter. `mw.context.returned` is an APIError on the
      // failure path (Better Auth catches the throw before invoking
      // after-hooks, see node_modules/better-auth/dist/api/to-auth-endpoints.mjs).
      after: createAuthMiddleware(async (mw) => {
        const runCtx = requireRunMutationCtx(ctx);
        const trusted = await loadTrustedProxies(runCtx);
        const ip = mw.request
          ? getClientIp(mw.request.headers, trusted)
          : undefined;
        const userAgent = mw.request?.headers.get('user-agent') ?? undefined;

        // Route /two-factor/* and the /sign-in/email enforcement check
        // through the 2FA hook module. Enforcement may return a replacement
        // response (twoFactorRedirect + enrollRequired) — when it does, we
        // cancel the default response after letting the existing
        // loginAttempts success path record the successful password step.
        const twoFactorReplacement = await twoFactorAfterHook(
          ctx,
          mw,
          ip,
          userAgent,
        );

        if (mw.path === SIGN_IN_EMAIL_PATH) {
          const email = bodyEmail(mw.body);
          if (email) {
            const returned = mw.context.returned;
            // Note: if the before-hook threw 429, Better Auth does NOT
            // invoke runAfterHooks. `recordBlocked` is called from the
            // before-hook directly. Anything that reaches here actually
            // made it to the password-check stage.
            const failed =
              returned instanceof APIError || !mw.context.newSession;
            if (failed) {
              await runCtx.runMutation(
                internal.login_attempts.internal_mutations.recordFailure,
                { email, ip, userAgent },
              );
            } else {
              await runCtx.runMutation(
                internal.login_attempts.internal_mutations.clearOnSuccess,
                { email, ip, userAgent },
              );
            }
          }

          if (twoFactorReplacement !== undefined) {
            // Replace the default session response with the enforcement
            // redirect. The session itself has already been deleted and
            // the Set-Cookie cleared inside `twoFactorAfterHook`.
            mw.context.returned = twoFactorReplacement;
          }
        }

        // After an API key is created, persist the trailing plaintext
        // chars on the row. The upstream plugin only stores `start`
        // (prefix); we need the suffix too so the table can render
        // `start … suffix`, matching the masking convention every major
        // vendor uses (AWS, GitHub, Stripe, OpenRouter) and letting users
        // disambiguate keys with the same `tale_` prefix.
        if (mw.path === '/api-key/create') {
          // The endpoint returns the created row plus the plaintext `key`
          // (see node_modules/@better-auth/api-key/dist/index.mjs:852).
          // `mw.context.returned` is that JSON object directly.
          const returned = mw.context.returned;
          const id = isRecord(returned) ? getString(returned, 'id') : null;
          const plaintext = isRecord(returned)
            ? getString(returned, 'key')
            : null;
          if (id && plaintext && plaintext.length > 4) {
            try {
              await runCtx.runMutation(
                components.betterAuth.adapter.updateMany,
                {
                  input: {
                    model: 'apikey',
                    where: [{ field: '_id', value: id, operator: 'eq' }],
                    update: { suffix: plaintext.slice(-4) },
                  },
                  paginationOpts: { cursor: null, numItems: 1 },
                },
              );
            } catch (err) {
              // Non-fatal: the key is already created and returned to the
              // user. Worst case: this row renders without a suffix in the
              // dashboard, matching pre-feature behaviour.
              console.warn(
                '[api-key/create] failed to persist suffix',
                err instanceof Error ? err.message : err,
              );
            }
          }
        }

        // Member-mirror catch-all. When the client calls
        // `authClient.organization.*` directly, Better Auth's org plugin
        // writes the `member` row inside the component — out of reach of our
        // custom Convex mutations' inline mirror sync. Re-derive the affected
        // mirror row(s) from source here so the RLS read cache can't go stale.
        // Idempotent and non-fatal (read-time Better Auth fallback + the
        // hourly reconcile cron self-heal). Skipped on the failure path, where
        // `mw.context.returned` is an APIError and no member row changed.
        if (
          (mw.path === '/organization/leave' ||
            mw.path === '/organization/remove-member' ||
            mw.path === '/organization/update-member-role' ||
            mw.path === '/organization/delete') &&
          !(mw.context.returned instanceof APIError)
        ) {
          try {
            const body = isRecord(mw.body) ? mw.body : {};
            const bodyOrgId = getString(body, 'organizationId');
            if (mw.path === '/organization/delete') {
              if (bodyOrgId) {
                await runCtx.runMutation(
                  internal.members.mirror_sync.cascadeDeleteOrgMembersMirror,
                  { organizationId: bodyOrgId },
                );
                // Same posture for the org's automation triggers: a surviving
                // schedule row would keep coming due (and crashing its runs)
                // forever (#3022). Own catch so a failure here isn't logged
                // under the mirror's label — the schedule scan retires
                // orphaned rows as the backstop either way.
                try {
                  await runCtx.runMutation(
                    internal.automations.triggers.cascadeDeleteOrgTriggers,
                    { organizationId: bodyOrgId },
                  );
                } catch (err) {
                  console.warn(
                    '[automations] trigger cascade after organization delete failed; the schedule scan will retire the rows',
                    err instanceof Error ? err.message : err,
                  );
                }
              }
            } else {
              const returned = isRecord(mw.context.returned)
                ? mw.context.returned
                : undefined;
              const returnedMember =
                returned && isRecord(returned.member)
                  ? returned.member
                  : undefined;
              const userId =
                (returnedMember
                  ? getString(returnedMember, 'userId')
                  : undefined) ?? getString(body, 'userId');
              const organizationId =
                bodyOrgId ??
                (returnedMember
                  ? getString(returnedMember, 'organizationId')
                  : undefined);
              if (organizationId && userId) {
                await runCtx.runMutation(
                  internal.members.mirror_sync.resyncOrgMemberMirror,
                  { organizationId, userId },
                );
              }
            }
          } catch (err) {
            console.warn(
              '[member-mirror] after-middleware sync failed',
              err instanceof Error ? err.message : err,
            );
          }
        }
      }),
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
        jwt: {
          definePayload: ({ user, session }) => {
            const sessionRecord = isRecord(session) ? session : {};
            return {
              email: user.email,
              name: user.name,
              trustedRole: getString(sessionRecord, 'trustedRole'),
              trustedTeams: getString(sessionRecord, 'trustedTeams'),
            };
          },
        },
      }),
      organization({
        ac,
        roles: orgRoles,
        creatorRole: 'owner',
        // Enable teams for multi-tenancy support (team-level data isolation)
        teams: {
          enabled: true,
          allowRemovingAllTeams: true,
          defaultTeam: {
            enabled: false,
          },
        },
        organizationHooks: {
          beforeCreateOrganization: async (data) => {
            const slug = data.organization.slug;
            if (!slug) return;
            // Normalize to lowercase BEFORE both the reservation and
            // uniqueness checks. Convex `eq` is byte-equal, so without
            // normalization a caller could pass `Default` to bypass
            // the reservation set (which lowercases) while also
            // bypassing the unique-slug `eq` lookup (case-sensitive).
            const normalizedSlug = slug.toLowerCase();
            // Reject anything that doesn't fit the canonical slug shape
            // so users can't smuggle invalid filesystem characters or
            // length-cap-busting strings past the auth boundary.
            // assertValidOrgSlug throws plain Error; wrap as
            // APIError('BAD_REQUEST') so Better Auth surfaces 400 to the
            // client rather than 500 (round-3 P2 R1-P2-a).
            try {
              assertValidOrgSlug(normalizedSlug);
            } catch (err) {
              throw new APIError('BAD_REQUEST', {
                message: err instanceof Error ? err.message : String(err),
              });
            }

            // Refuse reserved slugs ("default", "agents", "branding",
            // "providers", "retention", "skills", "workflows",
            // "connectors") — the platform pins on-disk and DB
            // resources to these names. `default` in particular is a
            // scaffold TEMPLATE, never a user organization: every new org
            // is seeded from the on-disk `default/` tree, and the
            // governance/branding baselines key off the literal slug
            // string (not a `default` org row). The first user picks their
            // own workspace name via the onboarding wizard, so there is no
            // longer any first-run path that needs to mint `default`.
            if (isReservedOrgSlug(normalizedSlug)) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is reserved by the platform.`,
              });
            }
            // Convex has no unique-index primitive, so enforce slug uniqueness
            // at application level before Better Auth's adapter writes the row.
            const existing = await ctx.runQuery(
              components.betterAuth.adapter.findOne,
              {
                model: 'organization',
                where: [
                  { field: 'slug', value: normalizedSlug, operator: 'eq' },
                ],
              },
            );
            if (existing) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is already taken.`,
              });
            }
            // Project the normalized slug back so the persisted row
            // matches what the checks just used. Use the same loose-
            // payload cast pattern as `beforeUpdateOrganization` below
            // instead of a try/catch swallow — if the assignment ever
            // throws (frozen object, etc.) it should surface, not
            // silently fall back to the caller-supplied case (which
            // would defeat the normalization the reservation + unique-
            // ness checks just relied on).
            (data.organization as Record<string, unknown>).slug =
              normalizedSlug;
          },
          beforeUpdateOrganization: async (data) => {
            // Re-run the create-time guards on update: without this
            // hook, an org owner could rename their org to a reserved
            // slug after creation and inherit branding-admin. Pulled
            // through a `Record<string, unknown>` view so the field
            // shape matches Better Auth's loose update payload type.
            const orgPatch = data.organization as Record<string, unknown>;
            // Org name is required: reject a rename that clears it (empty or
            // whitespace-only). Mirrors the client-side `.min(1)` validation so
            // an empty name can't slip past the auth boundary via a direct API
            // call. Only enforced when `name` is part of the patch — a name-less
            // update (e.g. locale-only) leaves the stored name untouched.
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
            if (typeof rawSlug !== 'string') return;
            const normalizedSlug = rawSlug.toLowerCase();
            try {
              assertValidOrgSlug(normalizedSlug);
            } catch (err) {
              throw new APIError('BAD_REQUEST', {
                message: err instanceof Error ? err.message : String(err),
              });
            }
            if (isReservedOrgSlug(normalizedSlug)) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is reserved by the platform.`,
              });
            }
            const collision = await ctx.runQuery(
              components.betterAuth.adapter.findOne,
              {
                model: 'organization',
                where: [
                  { field: 'slug', value: normalizedSlug, operator: 'eq' },
                ],
              },
            );
            // Exclude self from collision: Better Auth's payload carries
            // `data.member.organizationId` (the org being updated). Its
            // own pre-check at crud-org.mjs:213-215 does this same self-
            // exclude; without mirroring it here, any update that re-
            // sends the current slug (e.g. a name-only PATCH that
            // round-trips the full object) 400s with "already taken".
            const selfOrgId = (
              data.member as { organizationId?: unknown } | undefined
            )?.organizationId;
            const collisionIsSelf =
              typeof selfOrgId === 'string' &&
              isRecord(collision) &&
              getString(collision, '_id') === selfOrgId;
            if (collision && !collisionIsSelf) {
              throw new APIError('BAD_REQUEST', {
                message: `Organization slug "${normalizedSlug}" is already taken.`,
              });
            }
            // Project the normalized slug back onto the loose patch
            // shape; assignment is safe whether or not Better Auth
            // ends up re-validating it server-side.
            orgPatch.slug = normalizedSlug;
          },
          afterCreateOrganization: async (data) => {
            const slug = data.organization.slug;
            if (slug) {
              // Scaffolding is filesystem work, so defer to an action via
              // the scheduler. Failures here should NOT block org creation —
              // the scaffolder logs and continues per-domain.
              try {
                const runCtx = requireRunMutationCtx(ctx);
                await runCtx.scheduler.runAfter(
                  0,
                  internal.organizations.scaffold.scaffoldNewOrganization,
                  { orgSlug: slug, cleanFirst: true },
                );
                // Mirror the scaffolded governance files into `configCache` so
                // V8 readers (password/2FA/feature enforcement) see this org's
                // policies instead of falling back to schema defaults. Same
                // head-start delay as the provisioners below; the sync is
                // idempotent and re-derivable, so a missed beat self-heals on
                // the next write or the periodic reconcile cron.
                await runCtx.scheduler.runAfter(
                  10_000,
                  internal.lib.config_cache.sync_org.syncOrgConfigCaches,
                  { organizationId: data.organization.id },
                );
                // Seed the shipped automation packs into the org's automation
                // store as drafts (nothing deploys itself). Deferred so the
                // scaffold finishes copying files first; idempotent, so a
                // lost beat is healed by the next deploy's all-orgs run.
                await runCtx.scheduler.runAfter(
                  10_000,
                  internal.provisioning.provision_default_automations
                    .provisionDefaultAutomations,
                  { organizationId: data.organization.id, orgSlug: slug },
                );
                // The default-agent auto-install re-schedules
                // here when the chat rebuild lands its slim-agent provisioner.
                // Seed example content (a "Getting started" project + a few
                // tasks) after the agents are installed. Idempotent +
                // best-effort.
                await runCtx.scheduler.runAfter(
                  15_000,
                  internal.provisioning.seed_starter.seedStarterContent,
                  { organizationId: data.organization.id },
                );
              } catch (err) {
                console.error(
                  '[afterCreateOrganization] failed to schedule scaffold',
                  err instanceof Error ? err.message : err,
                );
              }
            }

            // Member-POV audit row: the creator just joined the org as
            // owner. Better Auth has already persisted the member record
            // with role='owner' before invoking this hook. Wrap defensively
            // so audit failures don't bubble to the client as a 500.
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.audit_logs.internal_mutations.logJoinedOrganization,
                {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                  userEmail: data.user.email,
                  userRole: data.member.role,
                },
              );
            } catch (err) {
              console.error(
                '[afterCreateOrganization] failed to write joined_organization audit',
                err instanceof Error ? err.message : err,
              );
            }

            // Seed the RLS read cache (`memberMirror`) with the creator's
            // owner membership. Awaited inline (not scheduled) so the very
            // first dashboard query reads a warm mirror instead of paying the
            // cross-component fallback. Non-fatal: a failure self-heals via the
            // read-time fallback and the hourly reconcile cron.
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.members.mirror_sync.resyncOrgMemberMirror,
                {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                },
              );
            } catch (err) {
              console.error(
                '[afterCreateOrganization] failed to sync member mirror',
                err instanceof Error ? err.message : err,
              );
            }
          },
          afterAcceptInvitation: async (data) => {
            // Member-POV audit row: the invitee just joined the org with
            // the role granted by the invitation. Better Auth persists the
            // member record before invoking this hook, so `data.member.role`
            // is authoritative. Wrapped defensively per the same rationale
            // as afterCreateOrganization.
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.audit_logs.internal_mutations.logJoinedOrganization,
                {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                  userEmail: data.user.email,
                  userRole: data.member.role,
                },
              );
            } catch (err) {
              console.error(
                '[afterAcceptInvitation] failed to write joined_organization audit',
                err instanceof Error ? err.message : err,
              );
            }

            // Seed the RLS read cache with the just-accepted membership so the
            // invitee's first authenticated query reads a warm mirror. Non-fatal
            // (read-time fallback + reconcile cron self-heal).
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.members.mirror_sync.resyncOrgMemberMirror,
                {
                  organizationId: data.organization.id,
                  userId: data.user.id,
                },
              );
            } catch (err) {
              console.error(
                '[afterAcceptInvitation] failed to sync member mirror',
                err instanceof Error ? err.message : err,
              );
            }
          },
          // teamMember mirror sync for client-direct Better Auth team endpoints
          // (Tale's custom mutations + the Entra SSO sync update the mirror
          // inline). Re-derive from source so it's idempotent; non-fatal — the
          // reconcile cron self-heals any miss.
          afterAddTeamMember: async (data) => {
            const teamId = getString(data.teamMember, 'teamId');
            const userId = getString(data.teamMember, 'userId');
            if (!teamId || !userId) return;
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.members.mirror_sync.resyncTeamMemberMirror,
                { teamId, userId },
              );
            } catch (err) {
              console.error(
                '[afterAddTeamMember] failed to sync team mirror',
                err instanceof Error ? err.message : err,
              );
            }
          },
          afterRemoveTeamMember: async (data) => {
            const teamId = getString(data.teamMember, 'teamId');
            const userId = getString(data.teamMember, 'userId');
            if (!teamId || !userId) return;
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.members.mirror_sync.resyncTeamMemberMirror,
                { teamId, userId },
              );
            } catch (err) {
              console.error(
                '[afterRemoveTeamMember] failed to sync team mirror',
                err instanceof Error ? err.message : err,
              );
            }
          },
          afterDeleteTeam: async (data) => {
            const teamId = getString(data.team, 'id');
            if (!teamId) return;
            try {
              const runCtx = requireRunMutationCtx(ctx);
              await runCtx.runMutation(
                internal.members.mirror_sync.cascadeDeleteTeamMembersMirror,
                { teamId },
              );
            } catch (err) {
              console.error(
                '[afterDeleteTeam] failed to cascade-delete team mirror',
                err instanceof Error ? err.message : err,
              );
            }
          },
        },
      }),
      apiKey({
        defaultPrefix: 'tale',
        apiKeyHeaders: ['x-api-key'],
        enableSessionForAPIKeys: true,
        rateLimit: {
          enabled: true,
          timeWindow: 60,
          maxRequests: 100,
        },
      }),
      // TOTP-based two-factor authentication (issue #1507).
      // Lockout on /two-factor/verify-* paths is enforced via the before-hook
      // above to prevent the 6-digit surface from bypassing password lockout.
      twoFactor({
        issuer: 'Tale',
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        skipVerificationOnEnable: false,
      }),
      // WebAuthn / passkeys as a phishing-resistant second factor (#1508).
      // rpID is the effective domain (hostname only, no scheme/port) and
      // origin is the full origin the ceremony runs against — both derived
      // from SITE_URL so a deployment behind its real domain works without
      // extra config. localhost defaults apply for dev.
      passkey({
        rpID: new URL(siteUrl).hostname,
        rpName: 'Tale',
        origin: new URL(siteUrl).origin,
      }),
    ],
  };
};

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly: _optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth(getAuthOptions(ctx));
};
