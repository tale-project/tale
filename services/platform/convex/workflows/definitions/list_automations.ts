import type { PaginationOptions } from 'convex/server';
import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface ListAutomationsArgs {
  organizationId: string;
  paginationOpts: PaginationOptions;
}

function resolveEffectiveStatus(
  name: string,
  activeByName: Map<string, WorkflowDefinition>,
  archivedNames: Set<string>,
) {
  if (activeByName.has(name)) return 'active';
  if (archivedNames.has(name)) return 'archived';
  return 'draft';
}

export async function listAutomations(
  ctx: QueryCtx,
  args: ListAutomationsArgs,
) {
  const { organizationId, paginationOpts } = args;

  const rootPage = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_org_versionNumber', (q) =>
      q.eq('organizationId', organizationId).eq('versionNumber', 1),
    )
    .paginate(paginationOpts);

  const names = [...new Set(rootPage.page.map((r) => r.name))];

  const [activeVersions, archivedVersions] = await Promise.all([
    Promise.all(
      names.map((name) =>
        ctx.db
          .query('wfDefinitions')
          .withIndex('by_org_name_status', (q) =>
            q
              .eq('organizationId', organizationId)
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
              .eq('organizationId', organizationId)
              .eq('name', name)
              .eq('status', 'archived'),
          )
          .first(),
      ),
    ),
  ]);

  const activeByName = new Map<string, WorkflowDefinition>();
  const archivedNames = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const active = activeVersions[i];
    if (active) activeByName.set(names[i], active);
    if (archivedVersions[i]) archivedNames.add(names[i]);
  }

  const enriched = rootPage.page.map((item) => {
    const activeVersion = activeByName.get(item.name);
    const status = resolveEffectiveStatus(
      item.name,
      activeByName,
      archivedNames,
    );

    return {
      ...item,
      status,
      version: activeVersion?.version ?? item.version,
      versionNumber: activeVersion?.versionNumber ?? item.versionNumber,
    };
  });

  return {
    page: enriched,
    isDone: rootPage.isDone,
    continueCursor: rootPage.continueCursor,
  };
}
