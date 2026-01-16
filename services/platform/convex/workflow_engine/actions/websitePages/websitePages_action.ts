import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type {
  WebsitePagesActionParams,
} from './helpers/types';
import { internal } from '../../../_generated/api';
import { jsonRecordValidator } from '../../../../lib/shared/schemas/utils/json-value';

// Page validator
const pageValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  content: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  word_count: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
  structuredData: v.optional(jsonRecordValidator),
  structured_data: v.optional(jsonRecordValidator),
});

export const websitePagesAction: ActionDefinition<WebsitePagesActionParams> = {
  type: 'websitePages',
  title: 'Website Pages',
  description:
    'Manage website pages (bulk upsert). organizationId is automatically read from workflow context variables.',

  // Using v.object() directly since only the 'bulk_upsert' operation exists
  parametersValidator: v.object({
    operation: v.literal('bulk_upsert'),
    websiteId: v.id('websites'),
    pages: v.array(pageValidator),
  }),

  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables
    const organizationId = variables.organizationId as string;

    if (!organizationId) {
      throw new Error(
        'bulk_upsert operation requires organizationId in context',
      );
    }

    const normalizedPages = params.pages.map((p) => ({
      url: p.url,
      title: p.title ?? undefined,
      content: p.content ?? undefined,
      wordCount: p.wordCount ?? p.word_count ?? undefined,
      metadata: p.metadata ?? undefined,
      structuredData: p.structuredData ?? p.structured_data ?? undefined,
    }));

    const result = await ctx.runMutation(
      internal.mutations.websites.bulkUpsertPagesInternal,
      {
        organizationId,
        websiteId: params.websiteId, // Required by validator
        pages: normalizedPages,
      },
    );

    // Note: execute_action_node wraps this in output: { type: 'action', data: result }
    return {
      operation: 'bulk_upsert' as const,
      created: result.created,
      updated: result.updated,
      total: result.total,
      success: true,
      timestamp: Date.now(),
    };
  },
};
