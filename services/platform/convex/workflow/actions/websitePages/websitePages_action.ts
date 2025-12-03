import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WebsitePagesActionParams } from './helpers/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

export const websitePagesAction: ActionDefinition<WebsitePagesActionParams> = {
  type: 'websitePages',
  title: 'Website Pages',
  description: 'Manage website pages (bulk upsert)',

  parametersValidator: v.object({
    operation: v.literal('bulk_upsert'),
    organizationId: v.optional(v.string()),
    websiteId: v.optional(v.string()),
    pages: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          description: v.optional(v.string()),
          content: v.optional(v.string()),
          wordCount: v.optional(v.number()),
          word_count: v.optional(v.number()),
          metadata: v.optional(v.any()),
          structuredData: v.optional(v.any()),
          structured_data: v.optional(v.any()),
        }),
      ),
    ),
  }),

  async execute(ctx, params) {
    if (!params.organizationId || !params.websiteId || !params.pages) {
      throw new Error(
        'bulk_upsert operation requires organizationId, websiteId, and pages parameters',
      );
    }

    const normalizedPages = params.pages.map((p: any) => ({
      url: p.url,
      title: p.title ?? undefined,
      content: p.content ?? undefined,
      wordCount: p.wordCount ?? p.word_count ?? undefined,
      metadata: p.metadata ?? undefined,
      structuredData: p.structuredData ?? p.structured_data ?? undefined,
    }));

    const result = await ctx.runMutation(
      internal.websites.bulkUpsertPagesInternal,
      {
        organizationId: params.organizationId,
        websiteId: params.websiteId as Id<'websites'>,
        pages: normalizedPages,
      },
    );

    return {
      operation: 'bulk_upsert',
      created: result.created,
      updated: result.updated,
      total: result.total,
      success: true,
      timestamp: Date.now(),
    };
  },
};
