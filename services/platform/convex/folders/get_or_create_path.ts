import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { MAX_FOLDER_DEPTH, validateFolderName } from './mutations';

export async function getOrCreateFolderPath(
  ctx: MutationCtx,
  organizationId: string,
  pathSegments: string[],
  createdBy?: string,
  teamId?: string,
): Promise<Id<'folders'> | undefined> {
  const segments = pathSegments.filter((s) => s.trim().length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  // Same cap enforced by the folder create mutation. Auto-vivification
  // paths (OneDrive import, WebDAV MKCOL/PUT/MOVE) must not bypass it.
  if (segments.length > MAX_FOLDER_DEPTH) {
    throw new ConvexError({ code: 'CONFLICT' });
  }

  let parentId: Id<'folders'> | undefined;

  for (const segment of segments) {
    let validName: string;
    try {
      validName = validateFolderName(segment);
    } catch {
      // Intentionally stop on invalid segments rather than throwing.
      // Callers (migration backfill, OneDrive import) rely on partial
      // path creation with their own error handling wrappers.
      console.warn(
        `[getOrCreateFolderPath] Stopped at invalid segment "${segment}" in path [${pathSegments.join('/')}]`,
      );
      break;
    }

    const existing = await ctx.db
      .query('folders')
      .withIndex('by_org_parent_name', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('parentId', parentId)
          .eq('name', validName),
      )
      .first();

    if (existing) {
      parentId = existing._id;
    } else {
      parentId = await ctx.db.insert('folders', {
        organizationId,
        name: validName,
        parentId,
        createdBy,
        teamId,
      });
    }
  }

  return parentId;
}
