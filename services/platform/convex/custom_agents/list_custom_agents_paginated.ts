import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';

export async function listCustomAgentsPaginated(
  ctx: QueryCtx,
  args: {
    paginationOpts: PaginationOptions;
    organizationId: string;
  },
): Promise<PaginationResult<Doc<'customAgents'>>> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return { page: [], isDone: true, continueCursor: '' };
  }

  const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

  const page = await ctx.db
    .query('customAgents')
    .withIndex('by_org_versionNumber', (q) =>
      q.eq('organizationId', args.organizationId).eq('versionNumber', 1),
    )
    .order('desc')
    .paginate(args.paginationOpts);

  const enrichedItems: Doc<'customAgents'>[] = [];

  for (const root of page.page) {
    if (!hasTeamAccess(root, userTeamIds)) continue;

    const draft = await ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', root._id).eq('status', 'draft'),
      )
      .first();

    if (draft) {
      enrichedItems.push(draft);
      continue;
    }

    const active = await ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', root._id).eq('status', 'active'),
      )
      .first();

    enrichedItems.push(active ?? root);
  }

  return { ...page, page: enrichedItems };
}
