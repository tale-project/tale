/**
 * Internal functions backing the integration-dispatch httpActions
 * (convex/integrations/dispatch_http.ts):
 *
 *   - getIntegrationAvailability — one slug's canonical availability (the gate
 *     the dispatch checks before executing).
 *   - getIntegrationStatuses     — all org integrations + availability (the
 *     `integration_status` tool's live source).
 *   - recordIntegrationCall      — append-only forensic audit row per call.
 *
 * Both readers run every failing condition through `computeAvailability`
 * (integrations/availability.ts) so the dispatch result and the status list
 * report blockers identically and cannot drift.
 */

import { v } from 'convex/values';

import { getString, isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import {
  computeAvailability,
  type CredentialStatus,
  type IntegrationAvailability,
} from './availability';

const blockerValidator = v.object({
  reason: v.string(),
  guidance: v.string(),
  connectUrl: v.optional(v.string()),
});

const availabilityValidator = v.object({
  slug: v.string(),
  title: v.string(),
  exists: v.boolean(),
  boundToAgent: v.boolean(),
  credentialActive: v.boolean(),
  blockers: v.array(blockerValidator),
  connectUrl: v.string(),
});

function toCredentialStatus(
  credential: { isActive: boolean; status: CredentialStatus } | null,
): { isActive: boolean; status: CredentialStatus } | null {
  if (!credential) return null;
  return { isActive: credential.isActive, status: credential.status };
}

/** One integration's availability for a session. `grantedSlugs` is the
 * session's `scope.integrationGrants` (the agent's integrationBindings). */
export const getIntegrationAvailability = internalAction({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    grantedSlugs: v.array(v.string()),
  },
  returns: availabilityValidator,
  handler: async (ctx, args): Promise<IntegrationAvailability> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const [fileResult, credential] = await Promise.all([
      ctx.runAction(
        internal.integrations.file_actions.readIntegrationForExecution,
        { orgSlug, slug: args.slug },
      ),
      ctx.runQuery(internal.integrations.credential_queries.getBySlugInternal, {
        organizationId: args.organizationId,
        slug: args.slug,
      }),
    ]);
    const exists = fileResult?.ok ?? false;
    const config = exists ? fileResult.config : undefined;
    const title = isRecord(config) ? getString(config, 'title') : undefined;
    return computeAvailability({
      slug: args.slug,
      organizationId: args.organizationId,
      title,
      exists,
      boundToAgent: args.grantedSlugs.includes(args.slug),
      credential: toCredentialStatus(credential),
    });
  },
});

/** Every org integration + its availability — the `integration_status` tool's
 * source. Connected-before-unconnected, then alphabetical (deterministic). */
export const getIntegrationStatuses = internalAction({
  args: {
    organizationId: v.string(),
    grantedSlugs: v.array(v.string()),
  },
  returns: v.array(availabilityValidator),
  handler: async (ctx, args): Promise<IntegrationAvailability[]> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const [catalog, creds] = await Promise.all([
      ctx.runAction(
        internal.integrations.file_actions.listIntegrationsInternal,
        { orgSlug },
      ),
      ctx.runQuery(internal.integrations.credential_queries.listInternal, {
        organizationId: args.organizationId,
      }),
    ]);
    const credBySlug = new Map<
      string,
      { isActive: boolean; status: CredentialStatus }
    >();
    for (const c of creds) {
      const mapped = toCredentialStatus(c);
      if (mapped) credBySlug.set(c.slug, mapped);
    }
    const granted = new Set(args.grantedSlugs);
    return catalog
      .map((entry) =>
        computeAvailability({
          slug: entry.slug,
          organizationId: args.organizationId,
          title: entry.title,
          exists: true,
          boundToAgent: granted.has(entry.slug),
          credential: credBySlug.get(entry.slug) ?? null,
        }),
      )
      .sort((a, b) => {
        if (a.credentialActive !== b.credentialActive) {
          return a.credentialActive ? -1 : 1;
        }
        return a.slug.localeCompare(b.slug);
      });
  },
});

/** Append-only forensic audit row for one agent-initiated dispatch call.
 * Never stores param values or secrets — only a sorted key fingerprint. */
export const recordIntegrationCall = internalMutation({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    slug: v.string(),
    operation: v.string(),
    operationType: v.optional(v.string()),
    userId: v.optional(v.string()),
    outcome: v.string(),
    paramsFingerprint: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('sandboxIntegrationCalls', {
      ...args,
      calledAt: Date.now(),
    });
    return null;
  },
});
