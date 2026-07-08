import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { validateFolderName } from './mutations';

/**
 * Read-only path lookup. Mirrors the traversal in `getOrCreateFolderPath`
 * but never inserts. Returns the leaf folder id, or `null` if any segment is
 * missing (or the input path is empty / fully invalid).
 *
 * Use this from action contexts that want to *find* a doc inside a sync-target
 * folder without materializing the folder hierarchy as a side effect — when
 * the path does not exist, no document can either, so the caller short-circuits.
 */
export async function findFolderByPath(
  ctx: QueryCtx,
  organizationId: string,
  pathSegments: string[],
): Promise<Id<'folders'> | null> {
  const segments = pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) {
    return null;
  }

  let parentId: Id<'folders'> | undefined;

  for (const segment of segments) {
    let validName: string;
    try {
      validName = validateFolderName(segment);
    } catch {
      return null;
    }

    // Hub-exact lookup: a project folder may share (org, parent, name) at
    // the root level — path resolution is a Knowledge Hub concept and must
    // never traverse into a project scope.
    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_project_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('projectId', undefined)
          .eq('parentId', parentId)
          .eq('name', validName),
      )
      .first();

    if (!existing) {
      return null;
    }
    parentId = existing._id;
  }

  return parentId ?? null;
}
