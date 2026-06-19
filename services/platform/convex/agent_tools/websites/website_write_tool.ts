/**
 * Convex Tool: Website Write
 *
 * Lets an agent register and update monitored website records (the `web` tool
 * only fetches pages; this manages the website entities the crawler scans).
 * Org-scoped via `websites/internal_mutations.ts`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const STATUS = z.enum(['idle', 'scanning', 'active', 'error']);

const websiteWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    domain: z.string().describe('Domain to register (e.g. example.com)'),
    title: z.string().optional(),
    description: z.string().optional(),
    scanInterval: z.string().optional().describe('e.g. "6h", "1d"'),
    status: STATUS.optional(),
  }),
  z.object({
    operation: z.literal('update'),
    websiteId: z.string().describe('Convex Id<"websites">'),
    domain: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    scanInterval: z.string().optional(),
    status: STATUS.optional(),
  }),
]);

export const websiteWriteTool: ToolDefinition = {
  name: 'website_write',
  tool: createTool({
    description: `Register and update monitored website records.

OPERATIONS:
• 'create': Register a website (by domain) for the organization to track/scan.
• 'update': Patch a website's fields by id.

This manages website ENTITIES; to read a page's content use the 'web' tool.`,
    inputSchema: websiteWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'create') {
        await ctx.runMutation(
          internal.websites.internal_mutations.provisionWebsite,
          {
            organizationId,
            domain: args.domain,
            title: args.title,
            description: args.description,
            scanInterval: args.scanInterval || '6h',
            status: args.status || 'active',
          },
        );
        const website = await ctx.runQuery(
          internal.websites.internal_queries.getWebsiteByDomain,
          { organizationId, domain: args.domain },
        );
        return { operation: 'create', website };
      }

      // operation === 'update'
      const result = await ctx.runMutation(
        internal.websites.internal_mutations.patchWebsite,
        {
          websiteId: toId<'websites'>(args.websiteId),
          domain: args.domain,
          title: args.title,
          description: args.description,
          scanInterval: args.scanInterval,
          status: args.status,
          callerOrgId: organizationId,
        },
      );
      return { operation: 'update', result };
    },
  }),
} as const;
