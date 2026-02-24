import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { WorkflowStatus } from '../../../lib/shared/schemas/wf_definitions';
import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

export type AutomationItem = Doc<'wfDefinitions'> & {
  activeVersionId: string | null;
};

function resolveEffectiveStatus(
  name: string,
  activeByName: Map<string, Doc<'wfDefinitions'>>,
  archivedNames: Set<string>,
): WorkflowStatus {
  if (activeByName.has(name)) return 'active';
  if (archivedNames.has(name)) return 'archived';
  return 'draft';
}

export async function listAutomationsPaginated(
  ctx: QueryCtx,
  args: {
    paginationOpts: PaginationOptions;
    organizationId: string;
  },
): Promise<PaginationResult<AutomationItem>> {
  const page = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_versionNumber', (q) =>
      q.eq('organizationId', args.organizationId).eq('versionNumber', 1),
    )
    .order('desc')
    .paginate(args.paginationOpts);

  const names = page.page.map((r) => r.name);

  const [activeVersions, archivedVersions] = await Promise.all([
    Promise.all(
      names.map((name) =>
        ctx.db
          .query('wfDefinitions')
          .withIndex('by_org_name_status', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('name', name)
              .eq('status', 'active'),
          )
          .first(),
      ),
    ),
    Promise.all(
      names.map((name) =>
        ctx.db
          .query('wfDefinitions')
          .withIndex('by_org_name_status', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('name', name)
              .eq('status', 'archived'),
          )
          .first(),
      ),
    ),
  ]);

  const activeByName = new Map<string, Doc<'wfDefinitions'>>();
  const archivedNames = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const active = activeVersions[i];
    if (active) activeByName.set(names[i], active);
    if (archivedVersions[i]) archivedNames.add(names[i]);
  }

  const enrichedPage: AutomationItem[] = page.page.map((root) => {
    const activeVersion = activeByName.get(root.name);
    const status = resolveEffectiveStatus(
      root.name,
      activeByName,
      archivedNames,
    );
    return {
      ...root,
      status,
      version: activeVersion?.version ?? root.version,
      versionNumber: activeVersion?.versionNumber ?? root.versionNumber,
      activeVersionId: activeVersion?._id ?? null,
    };
  });

  return { ...page, page: enrichedPage };
}
