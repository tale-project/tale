import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { apiKey, organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  defaultStatements,
  adminAc,
} from 'better-auth/plugins/organization/access';

import { isRecord, getString } from '../lib/utils/type-guards';
import { components, internal } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import authConfig from './auth.config';
import authSchema from './betterAuth/schema';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from './lib/rate_limiter/helpers';
import { getClientIp, loadTrustedProxies } from './lib/utils/client_ip';

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
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  promptTemplates: ['read', 'write'],
  messageFeedback: ['read', 'write'],
  mcpServers: ['read', 'write'],
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
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  promptTemplates: ['read', 'write'],
  messageFeedback: ['read', 'write'],
  mcpServers: ['read', 'write'],
});

const developer = ac.newRole({
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: ['read', 'write'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read'],
  promptTemplates: ['read', 'write'],
  messageFeedback: ['read', 'write'],
  mcpServers: ['read', 'write'],
});

const editor = ac.newRole({
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  // integrations/providers/onedrive/workflow: read only
  integrations: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: ['read'],
  workflowProcessingRecords: ['read'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read'],
  promptTemplates: ['read', 'write'],
  messageFeedback: ['read', 'write'],
  mcpServers: ['read'],
  // No access to: settings, automations (frontend menu restricted)
});

const member = ac.newRole({
  agents: ['read'],
  documents: ['read'],
  products: ['read'],
  customers: ['read'],
  vendors: ['read'],
  integrations: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read'],
  conversationMessages: ['read'],
  wfDefinitions: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: ['read'], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: ['read'],
  workflowProcessingRecords: ['read'],
  approvals: ['read'],
  websites: ['read'],
  auditLogs: ['read'],
  governancePolicies: ['read'],
  promptTemplates: ['read'],
  messageFeedback: ['read', 'write'],
  mcpServers: ['read'],
  // No access to: settings, automations (frontend menu restricted)
});

const disabled = ac.newRole({
  agents: [],
  documents: [],
  products: [],
  customers: [],
  vendors: [],
  integrations: [],
  onedriveSyncConfigs: [],
  conversations: [],
  conversationMessages: [],
  wfDefinitions: [], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepDefs: [], // @deprecated — DB table deprecated; permission for legacy data access only
  wfStepAuditLogs: [], // @deprecated — DB table deprecated; permission for legacy data access only
  wfExecutions: [],
  workflowProcessingRecords: [],
  approvals: [],
  websites: [],
  auditLogs: [],
  governancePolicies: [],
  promptTemplates: [],
  messageFeedback: [],
  mcpServers: [],
});

const owner = admin;

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
    session: {
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
        if (mw.path !== SIGN_IN_EMAIL_PATH) return;

        const email = bodyEmail(mw.body);
        if (!email) return;

        const returned = mw.context.returned;
        const runCtx = requireRunMutationCtx(ctx);
        const trusted = await loadTrustedProxies(runCtx);
        const ip = mw.request
          ? getClientIp(mw.request.headers, trusted)
          : undefined;
        const userAgent = mw.request?.headers.get('user-agent') ?? undefined;

        // Note: if the before-hook threw 429, Better Auth does NOT invoke
        // runAfterHooks. `recordBlocked` is called from the before-hook
        // directly. Anything that reaches here actually made it to the
        // password-check stage.

        const failed = returned instanceof APIError || !mw.context.newSession;
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
    ],
  };
};

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly: _optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth(getAuthOptions(ctx));
};
