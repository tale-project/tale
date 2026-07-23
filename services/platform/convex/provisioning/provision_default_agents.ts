'use node';

/**
 * Provision the default (autoInstall) agents to EXISTING
 * organizations (new orgs get them from the org-creation hook). Idempotent —
 * per-agent `agentDefaultProvisions` rows make re-runs no-ops, and orgs that
 * disabled/uninstalled a seeded agent are never re-provisioned behind their
 * back. Mirrors `provision_default_prompts.ts`.
 *
 *  - `provisionDefaultAgentsAllOrgs` — registered in `provisioning.ts:provisionAll`,
 *    so the default roster comes PREINSTALLED for every org on every deploy.
 *  - `provisionDefaultAgents` — single-org ops tool:
 *    bunx convex run provisioning/provision_default_agents:provisionDefaultAgents \
 *      '{ "organizationId": "<org-id>", "orgSlug": "<org-slug>" }'
 */

import { v } from 'convex/values';

import { isValidOrgSlug } from '../../lib/shared/constants/org-slug';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { internalAction } from '../_generated/server';

interface OrgRef {
  id: string;
  slug: string;
}

/**
 * Normalize one `betterAuth.adapter.findMany` page into the orgs it carries plus
 * the next cursor / done flag. A non-record/garbled response terminates the walk
 * (empty page, null cursor, done) so a backend hiccup never loops forever.
 */
function parseOrgPage(res: unknown): {
  orgs: OrgRef[];
  cursor: string | null;
  isDone: boolean;
} {
  if (!isRecord(res)) return { orgs: [], cursor: null, isDone: true };
  const orgs: OrgRef[] = [];
  const page = Array.isArray(res.page) ? res.page : [];
  for (const raw of page) {
    if (!isRecord(raw)) continue;
    const id = getString(raw, '_id') ?? getString(raw, 'id');
    const slug = getString(raw, 'slug');
    if (!id || !slug || !isValidOrgSlug(slug)) continue;
    orgs.push({ id, slug });
  }
  return {
    orgs,
    cursor: typeof res.continueCursor === 'string' ? res.continueCursor : null,
    isDone: typeof res.isDone === 'boolean' ? res.isDone : true,
  };
}

export const provisionDefaultAgents = internalAction({
  args: { organizationId: v.string(), orgSlug: v.string() },
  returns: v.object({
    provisioned: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ provisioned: number; skipped: number; failed: number }> => {
    // Default-agent installs return with the chat rebuild
    // slim-agent provisioner. Deploy-time provisioning must stay callable
    // and idempotent, so this reports a clean no-op instead of throwing.
    void ctx;
    console.log(
      '[AgentProvision] skipped — agent backend rewrite in progress',
      {
        organizationId: args.organizationId,
      },
    );
    return { provisioned: 0, skipped: 0, failed: 0 };
  },
});

export const provisionDefaultAgentsAllOrgs = internalAction({
  args: {},
  returns: v.object({
    orgs: v.number(),
    provisioned: v.number(),
    failedOrgs: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ orgs: number; provisioned: number; failedOrgs: number }> => {
    const orgs: OrgRef[] = [];
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    const MAX_PAGES = 1000;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= MAX_PAGES) {
        throw new Error(
          `provisionDefaultAgentsAllOrgs: pagination did not terminate within ${MAX_PAGES} pages`,
        );
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        throw new Error(
          'provisionDefaultAgentsAllOrgs: pagination cursor did not advance',
        );
      }
      prevCursor = cursor;
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const parsed = parseOrgPage(res);
      orgs.push(...parsed.orgs);
      cursor = parsed.cursor;
      isDone = parsed.isDone;
    }

    const provisioned = 0;
    let failedOrgs = 0;
    for (const org of orgs.sort((a, b) => a.slug.localeCompare(b.slug))) {
      try {
        // Per-org default-agent install returns with chat
        // v2; the fleet sweep stays callable as a no-op meanwhile.
        console.log('[AgentProvision] skipped (rewrite in progress)', {
          orgSlug: org.slug,
        });
      } catch (error) {
        // One broken org must not block the fleet; the next deploy retries.
        failedOrgs += 1;
        console.error('[AgentProvision] org provisioning failed', {
          orgSlug: org.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[AgentProvision] all-orgs run', {
      orgs: orgs.length,
      provisioned,
      failedOrgs,
    });
    return { orgs: orgs.length, provisioned, failedOrgs };
  },
});
