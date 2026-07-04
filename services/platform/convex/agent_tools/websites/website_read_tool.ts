/**
 * Convex Tool: Website Read
 *
 * Read the monitored website records (the entities the crawler scans). The
 * `web` tool fetches live page content; this lists/looks up the website
 * entities the org tracks. Org-scoped via `websites/internal_queries.ts`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const websiteReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list'),
  }),
  z.object({
    operation: z.literal('get_by_domain'),
    domain: z.string().describe('Domain to look up (e.g. example.com)'),
  }),
]);

export const websiteReadTool: ToolDefinition = {
  name: 'website_read',
  availability: 'any',
  tool: createTool({
    description: `Read the monitored website records for the organization.

OPERATIONS:
• 'list': List the websites the organization tracks (domain, title, status).
• 'get_by_domain': Look up a single website record by domain.

This reads website ENTITIES; to fetch a page's live content use the 'web' tool.`,
    inputSchema: websiteReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'list') {
        const websites = await ctx.runQuery(
          internal.websites.internal_queries.listWebsiteSummaries,
          { organizationId },
        );
        return { operation: 'list', websites };
      }

      // operation === 'get_by_domain'
      const website = await ctx.runQuery(
        internal.websites.internal_queries.getWebsiteByDomain,
        { organizationId, domain: args.domain },
      );
      return { operation: 'get_by_domain', website };
    },
  }),
} as const;
