import type { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function getOrganizationId(
  ctx: MutationCtx,
): Promise<string | null> {
  const orgsResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'organization',
    paginationOpts: {
      cursor: null,
      numItems: 2,
    },
    where: [],
  });

  if (!orgsResult || orgsResult.page.length !== 1) {
    console.warn(
      '[SSO] Expected exactly one organization, found:',
      orgsResult?.page.length ?? 0,
    );
    return null;
  }

  return orgsResult.page[0]._id;
}
