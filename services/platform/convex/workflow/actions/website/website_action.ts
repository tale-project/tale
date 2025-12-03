import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WebsiteActionParams } from './helpers/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

export const websiteAction: ActionDefinition<WebsiteActionParams> = {
  type: 'website',
  title: 'Website Operation',
  description:
    'Execute website-specific operations (create, update, get_by_domain)',

  parametersValidator: v.object({
    operation: v.union(
      v.literal('create'),
      v.literal('update'),
      v.literal('get_by_domain'),
    ),
    websiteId: v.optional(v.id('websites')),
    organizationId: v.optional(v.string()),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    metadata: v.optional(v.any()),
  }),

  async execute(ctx, params) {
    switch (params.operation) {
      case 'create': {
        if (!params.organizationId || !params.domain) {
          throw new Error(
            'create operation requires organizationId and domain parameters',
          );
        }

        const result = await ctx.runMutation(
          internal.websites.createWebsiteInternal,
          {
            organizationId: params.organizationId,
            domain: params.domain,
            title: params.title,
            description: params.description,
            scanInterval: params.scanInterval || '6h',
            lastScannedAt: params.lastScannedAt,
            status: params.status || 'active',
            metadata: params.metadata,
          },
        );

        return {
          operation: 'create',
          websiteId: result,
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'update': {
        if (!params.websiteId) {
          throw new Error('update operation requires websiteId parameter');
        }

        const result = await ctx.runMutation(
          internal.websites.updateWebsiteInternal,
          {
            websiteId: params.websiteId as Id<'websites'>,
            domain: params.domain,
            title: params.title,
            description: params.description,
            scanInterval: params.scanInterval,
            lastScannedAt: params.lastScannedAt,
            status: params.status,
            metadata: params.metadata,
          },
        );

        return {
          operation: 'update',
          website: result,
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'get_by_domain': {
        if (!params.organizationId || !params.domain) {
          throw new Error(
            'get_by_domain operation requires organizationId and domain parameters',
          );
        }

        const result = await ctx.runQuery(
          internal.websites.getWebsiteByDomainInternal,
          {
            organizationId: params.organizationId,
            domain: params.domain,
          },
        );

        return {
          operation: 'get_by_domain',
          website: result,
          found: !!result,
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(`Unknown operation: ${params.operation}`);
    }
  },
};
