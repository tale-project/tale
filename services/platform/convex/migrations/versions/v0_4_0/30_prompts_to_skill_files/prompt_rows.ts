/**
 * V8 read access to `promptTemplates` for the skill-file export.
 *
 * A node migration runs outside the database, so the rows it exports arrive
 * through this query. `promptTemplates` is still a declared table, so this
 * reads it normally and through its real index — no untyped table access is
 * warranted here, and none is used.
 *
 * The export never writes to the table: the rows stay exactly as they are
 * until a later, separate step drains and drops them once nothing reads them.
 */

import { v } from 'convex/values';

import { internalQuery } from '../../../../_generated/server';
import type { PromptTemplateRow } from './mapping';

/** Every prompt template belonging to one organization. */
export const listPromptTemplatesByOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<PromptTemplateRow[]> => {
    const rows = await ctx.db
      .query('promptTemplates')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      organizationId: row.organizationId,
      createdBy: row.createdBy,
      title: row.title,
      content: row.content,
      description: row.description,
      scope: row.scope,
      teamId: row.teamId,
      category: row.category,
      tags: row.tags,
      lifecycleStatus: row.lifecycleStatus,
    }));
  },
});
