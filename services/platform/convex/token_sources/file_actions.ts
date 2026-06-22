'use node';

import path from 'node:path';

import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { readdirSafe } from '../lib/file_io';
import { loadTokenSource, resolveTokenSourcesDir } from './file_utils';

/**
 * List the org's configured token sources (slug + display name) for the agent
 * Environment-tab selector. Reads the `token-sources/` config dir; skips any
 * file that fails to parse so one bad config can't hide the rest.
 */
export const listTokenSources = action({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      slug: v.string(),
      displayName: v.string(),
      targetEnvVar: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveTokenSourcesDir(orgSlug);
    const files = await readdirSafe(dir);
    const out: { slug: string; displayName: string; targetEnvVar: string }[] =
      [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const slug = path.basename(file, '.json');
      const read = await loadTokenSource(orgSlug, slug);
      if (!read.ok) continue;
      out.push({
        slug: read.config.slug,
        displayName: read.config.displayName,
        targetEnvVar: read.config.targetEnvVar,
      });
    }
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return out;
  },
});
