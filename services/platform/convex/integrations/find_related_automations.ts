import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export interface RelatedAutomation {
  _id: Id<'wfDefinitions'>;
  name: string;
  status: 'draft' | 'active' | 'archived';
  activeVersionId: string | null;
}

/**
 * Find all automations (workflow definitions) that reference a given
 * integration by name. Scans action steps in the org and resolves
 * back to root workflow definitions with effective status.
 */
export async function findRelatedAutomations(
  ctx: QueryCtx,
  args: { organizationId: string; integrationName: string },
): Promise<RelatedAutomation[]> {
  const { organizationId, integrationName } = args;

  // Collect distinct wfDefinitionIds that reference this integration
  const definitionIds = new Set<Id<'wfDefinitions'>>();

  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_organizationId_and_stepType_and_order', (q) =>
      q.eq('organizationId', organizationId).eq('stepType', 'action'),
    )) {
    const { config } = step;
    if (!('type' in config) || !('parameters' in config)) continue;
    const { type, parameters } = config;
    if (!type || !parameters) continue;

    const matches =
      (type === 'integration' && parameters.name === integrationName) ||
      (type === 'conversation' &&
        'integrationName' in parameters &&
        parameters.integrationName === integrationName);

    if (matches) {
      definitionIds.add(step.wfDefinitionId);
    }
  }

  if (definitionIds.size === 0) return [];

  // Resolve each definition to its root (versionNumber === 1)
  const rootIds = new Set<Id<'wfDefinitions'>>();
  const rootDocs = new Map<
    Id<'wfDefinitions'>,
    { _id: Id<'wfDefinitions'>; name: string }
  >();

  await Promise.all(
    [...definitionIds].map(async (defId) => {
      const def = await ctx.db.get(defId);
      if (!def) return;

      const rootId = def.rootVersionId ?? def._id;
      if (rootIds.has(rootId)) return;
      rootIds.add(rootId);

      if (def.rootVersionId) {
        const root = await ctx.db.get(def.rootVersionId);
        if (root) {
          rootDocs.set(rootId, { _id: root._id, name: root.name });
        }
      } else {
        rootDocs.set(rootId, { _id: def._id, name: def.name });
      }
    }),
  );

  // For each root, find the active version to determine effective status.
  // Only report status='active' if the active version itself references
  // this integration (not just a draft/archived sibling).
  const results: RelatedAutomation[] = [];

  await Promise.all(
    [...rootDocs.values()].map(async (root) => {
      // Check for active version
      let activeVersion: { _id: Id<'wfDefinitions'> } | null = null;
      for await (const v of ctx.db
        .query('wfDefinitions')
        .withIndex('by_root_status', (q) =>
          q.eq('rootVersionId', root._id).eq('status', 'active'),
        )) {
        activeVersion = v;
        break;
      }

      // If no active version found via rootVersionId, the root itself might be active
      if (!activeVersion) {
        const rootDoc = await ctx.db.get(root._id);
        if (rootDoc?.status === 'active') {
          activeVersion = rootDoc;
        }
      }

      // Determine effective status — only mark as 'active' if the active
      // version itself references the integration (it's in definitionIds).
      let status: 'draft' | 'active' | 'archived' = 'draft';
      if (activeVersion && definitionIds.has(activeVersion._id)) {
        status = 'active';
      } else {
        // Check for archived
        let hasArchived = false;
        for await (const _v of ctx.db
          .query('wfDefinitions')
          .withIndex('by_root_status', (q) =>
            q.eq('rootVersionId', root._id).eq('status', 'archived'),
          )) {
          hasArchived = true;
          break;
        }
        if (!hasArchived) {
          const rootDoc = await ctx.db.get(root._id);
          if (rootDoc?.status === 'archived') hasArchived = true;
        }
        if (hasArchived) status = 'archived';
      }

      results.push({
        _id: root._id,
        name: root.name,
        status,
        activeVersionId:
          activeVersion && definitionIds.has(activeVersion._id)
            ? activeVersion._id
            : null,
      });
    }),
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
