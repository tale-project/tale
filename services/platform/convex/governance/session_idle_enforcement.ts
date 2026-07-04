/**
 * Server-side enforcement for the per-org `session_idle_timeout` governance
 * policy (#1502).
 *
 * Better Auth's sliding `expiresIn` only enforces the deployment-wide
 * `SESSION_IDLE_TIMEOUT_MINUTES` backstop. The per-org policy used to be
 * client-enforced only (the idle watchdog), so a closed tab or a stolen
 * cookie outlived the org window whenever the env var was unset. This module
 * closes that gap at the session-row layer: a 5-minute cron sweep
 * (`crons.ts`) revokes sessions whose `updatedAt` is older than the user's
 * effective idle window.
 *
 * Why a sweep and not per-request policy reads: resolving the org policy on
 * every request would defeat the JWT-only fast path (the reason per-request
 * enforcement was rejected when the policy shipped). The sweep targets the
 * sessions the client watchdog cannot cover — closed/abandoned browsers and
 * stolen cookies — while open tabs keep refreshing tokens, which slides
 * `session.updatedAt` (see `sessionIdleWindowSeconds` in
 * `lib/shared/session-idle.ts` for the `updateAge` cadence that makes
 * `updatedAt` a usable activity proxy).
 *
 * Enforcement keying: a user's window is the STRICTEST enabled
 * `session_idle_timeout` window across every org they belong to, each already
 * tightened against the env backstop (precedent:
 * `getStrictestPasswordPolicyForUser`, `mergeStrictestTwoFactorPolicy`).
 *
 * Worst-case enforcement latency ≈ window + ~15-min `updatedAt` staleness
 * (token-refresh cadence) + 5-min cron tick + ~15-min JWT tail.
 *
 * Better Auth api-key "sessions" (`enableSessionForAPIKeys`) are mock
 * in-memory sessions assembled per request — never persisted to the
 * `session` model — so the sweep cannot churn them.
 */

import { v } from 'convex/values';

import { sessionIdleTimeoutConfigSchema } from '../../lib/shared/schemas/governance';
import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
} from '../../lib/shared/session-idle';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import type {
  BetterAuthFindManyResult,
  BetterAuthMember,
  BetterAuthSession,
} from '../members/types';

// Per-run budgets. Adapter calls are cross-component sub-transactions (the
// dominant cost), so the sweep bounds them: orgs × member pages on the read
// side, plus one session lookup per windowed user, plus one delete + one
// audit insert per revocation. The 5-minute cadence catches whatever a capped
// run leaves over — revoked sessions leave the table, so a backlog drains
// across ticks instead of starving the tail.
const MAX_ORGS_PER_RUN = 50;
const MEMBER_PAGE_SIZE = 200;
const MAX_MEMBER_PAGES_PER_ORG = 5;
const SESSION_PAGE_SIZE = 100;
const MAX_REVOCATIONS_PER_RUN = 100;

interface OrgIdleWindow {
  organizationId: string;
  minutes: number;
}

/**
 * Resolve the orgs that have an ENABLED `session_idle_timeout` policy into
 * their effective idle window (already tightened against the env backstop).
 * Invalid configs are logged and skipped (parse-or-skip, like
 * `getTwoFactorPolicy`); disabled/absent policies defer to the env backstop,
 * which Better Auth's own sliding `expiresIn` already enforces server-side —
 * nothing for the sweep to do there.
 *
 * Pure (env value passed in, not read here) so it is unit-testable.
 */
export function resolveOrgIdleWindows(
  policies: ReadonlyArray<{ organizationId: string; config: unknown }>,
  envMinutes: number | null,
): OrgIdleWindow[] {
  const windows: OrgIdleWindow[] = [];
  for (const row of policies) {
    const parsed = sessionIdleTimeoutConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      console.warn(
        `[session-idle] invalid session_idle_timeout config for org ${row.organizationId}; skipping sweep for this org`,
        parsed.error,
      );
      continue;
    }
    if (!parsed.data.enabled) continue;
    const minutes = resolveEffectiveIdleMinutes({
      policy: parsed.data,
      envMinutes,
    });
    if (minutes === null) continue;
    windows.push({ organizationId: row.organizationId, minutes });
  }
  return windows;
}

/**
 * Revocation decision for a single session row. Already-expired sessions are
 * dead — Better Auth rejects them on next use — so revoking them would only
 * burn the per-run write budget.
 */
export function shouldRevokeIdleSession(args: {
  updatedAt: number;
  expiresAt: number;
  windowMs: number;
  now: number;
}): boolean {
  if (args.expiresAt <= args.now) return false;
  return args.now - args.updatedAt > args.windowMs;
}

/**
 * Cron entry point: revoke sessions idle past their org policy window.
 *
 * Per run: enumerate orgs with an enabled policy, fold each org's members
 * into a per-user strictest window, then check each windowed user's session
 * rows and delete the ones idle past the window. Every revocation writes a
 * `security`-category audit row (one per session, per the #1502 decision)
 * so the control is evidenced per event.
 */
export const revokeIdleSessions = internalMutation({
  args: {},
  returns: v.object({
    orgsWithWindow: v.number(),
    usersChecked: v.number(),
    revoked: v.number(),
  }),
  handler: async (ctx) => {
    if (isE2ECronSuppressed())
      return { orgsWithWindow: 0, usersChecked: 0, revoked: 0 };
    const now = Date.now();
    const envMinutes = parseSessionIdleTimeoutMinutes();

    // Enumerate orgs with the policy configured. Ranges the `configCache`
    // `by_domain_key` index on `(domain='governance', key='session_idle_timeout')`
    // so it reads exactly the session-idle rows (one per org) — same bounds as
    // `listRetentionPolicies`, no whole-cache scan.
    const policyRows: Array<{ organizationId: string; config: unknown }> = [];
    for await (const policy of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', 'governance').eq('key', 'session_idle_timeout'),
      )) {
      policyRows.push({
        organizationId: policy.organizationId,
        config: policy.config,
      });
    }

    let orgWindows = resolveOrgIdleWindows(policyRows, envMinutes);
    if (orgWindows.length > MAX_ORGS_PER_RUN) {
      console.warn(
        `[session-idle] ${orgWindows.length} orgs have an enabled session_idle_timeout policy; sweeping the first ${MAX_ORGS_PER_RUN} this run`,
      );
      orgWindows = orgWindows.slice(0, MAX_ORGS_PER_RUN);
    }
    if (orgWindows.length === 0) {
      return { orgsWithWindow: 0, usersChecked: 0, revoked: 0 };
    }

    // Fold memberships into a per-user strictest window. A multi-org user
    // gets the minimum window across their orgs; the audit row is attributed
    // to the org whose window decided the revocation.
    const userWindows = new Map<
      string,
      { minutes: number; organizationId: string }
    >();
    for (const { organizationId, minutes } of orgWindows) {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_MEMBER_PAGES_PER_ORG; page++) {
        const membersResult: BetterAuthFindManyResult<BetterAuthMember> =
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'member',
            paginationOpts: { cursor, numItems: MEMBER_PAGE_SIZE },
            where: [
              {
                field: 'organizationId',
                value: organizationId,
                operator: 'eq',
              },
            ],
          });
        for (const member of membersResult?.page ?? []) {
          if (!member.userId) continue;
          const existing = userWindows.get(member.userId);
          if (!existing || minutes < existing.minutes) {
            userWindows.set(member.userId, { minutes, organizationId });
          }
        }
        if (membersResult?.isDone !== false || !membersResult.continueCursor) {
          break;
        }
        cursor = membersResult.continueCursor;
      }
    }

    let usersChecked = 0;
    let revoked = 0;
    for (const [userId, { minutes, organizationId }] of userWindows) {
      if (revoked >= MAX_REVOCATIONS_PER_RUN) break;
      usersChecked++;
      const windowMs = minutes * 60 * 1000;
      const sessionsResult: BetterAuthFindManyResult<BetterAuthSession> =
        await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'session',
          paginationOpts: { cursor: null, numItems: SESSION_PAGE_SIZE },
          where: [{ field: 'userId', value: userId, operator: 'eq' }],
        });
      for (const session of sessionsResult?.page ?? []) {
        if (revoked >= MAX_REVOCATIONS_PER_RUN) break;
        const eligible = shouldRevokeIdleSession({
          updatedAt: session.updatedAt,
          expiresAt: session.expiresAt,
          windowMs,
          now,
        });
        if (!eligible) continue;

        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: 'session',
            where: [{ field: '_id', value: session._id, operator: 'eq' }],
          },
        });
        await AuditLogHelpers.createAuditLog(ctx, {
          organizationId,
          actorId: 'system',
          actorType: 'system',
          action: 'session.idle_revoked',
          category: 'security',
          resourceType: 'session',
          resourceId: session._id,
          status: 'success',
          metadata: {
            userId,
            idleTimeoutMinutes: minutes,
            sessionUpdatedAt: session.updatedAt,
            sessionExpiresAt: session.expiresAt,
          },
        });
        revoked++;
      }
    }

    return { orgsWithWindow: orgWindows.length, usersChecked, revoked };
  },
});
