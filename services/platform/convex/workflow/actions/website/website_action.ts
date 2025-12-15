import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { WebsiteActionParams } from './helpers/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

// Common field validators
const statusValidator = v.optional(
  v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
);

export const websiteAction: ActionDefinition<WebsiteActionParams> = {
  type: 'website',
  title: 'Website Operation',
  description:
    'Execute website-specific operations (create, update, get_by_domain). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    // create: Create a new website
    v.object({
      operation: v.literal('create'),
      domain: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      scanInterval: v.optional(v.string()),
      lastScannedAt: v.optional(v.number()),
      status: statusValidator,
      metadata: v.optional(v.any()),
    }),
    // update: Update an existing website
    v.object({
      operation: v.literal('update'),
      websiteId: v.id('websites'),
      domain: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      scanInterval: v.optional(v.string()),
      lastScannedAt: v.optional(v.number()),
      status: statusValidator,
      metadata: v.optional(v.any()),
    }),
    // get_by_domain: Get a website by domain
    v.object({
      operation: v.literal('get_by_domain'),
      domain: v.string(),
    }),
  ),

  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables
    const organizationId = variables.organizationId as string;

    switch (params.operation) {
      case 'create': {
        if (!organizationId) {
          throw new Error(
            'create operation requires organizationId in context',
          );
        }

        const websiteId = await ctx.runMutation(
          internal.websites.createWebsiteInternal,
          {
            organizationId,
            domain: params.domain, // Required by validator
            title: params.title,
            description: params.description,
            scanInterval: params.scanInterval || '6h',
            lastScannedAt: params.lastScannedAt,
            status: params.status || 'active',
            metadata: params.metadata,
          },
        );

        // Fetch and return the full created entity
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const createdWebsite = await ctx.runQuery(
          internal.websites.getWebsiteByDomainInternal,
          { organizationId, domain: params.domain },
        );

        if (!createdWebsite) {
          throw new Error(
            `Failed to fetch created website with domain "${params.domain}"`,
          );
        }

        return createdWebsite;
      }

      case 'update': {
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const result = await ctx.runMutation(
          internal.websites.updateWebsiteInternal,
          {
            websiteId: params.websiteId, // Required by validator
            domain: params.domain,
            title: params.title,
            description: params.description,
            scanInterval: params.scanInterval,
            lastScannedAt: params.lastScannedAt,
            status: params.status,
            metadata: params.metadata,
          },
        );

        return result;
      }

      case 'get_by_domain': {
        if (!organizationId) {
          throw new Error(
            'get_by_domain requires organizationId in context',
          );
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        const result = await ctx.runQuery(
          internal.websites.getWebsiteByDomainInternal,
          {
            organizationId,
            domain: params.domain, // Required by validator
          },
        );

        return result;
      }

      default:
        throw new Error(
          `Unknown operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
