/**
 * Convex Tool: Discussion Read
 *
 * Read-only access to project discussions (GitHub-Discussions-style threads
 * that live under a project and reuse the chat message store). Lets an agent
 * find open questions/decisions and read a discussion transcript before
 * replying or acting on it.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const discussionReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list'),
    projectId: z
      .string()
      .describe('Convex Id<"projects"> to list discussions for'),
    category: z
      .string()
      .optional()
      .describe(
        'Filter by category (general/qa/ideas/decisions/announcements/show-and-tell/polls)',
      ),
    status: z
      .enum(['open', 'resolved', 'locked'])
      .optional()
      .describe('Filter by lifecycle status'),
    limit: z.number().optional().describe('Max discussions to return'),
  }),
  z.object({
    operation: z.literal('get'),
    threadId: z.string().describe('Discussion thread id'),
  }),
  z.object({
    operation: z.literal('get_messages'),
    threadId: z
      .string()
      .describe('Discussion thread id to read the transcript of'),
  }),
]);

export const discussionReadTool: ToolDefinition = {
  name: 'discussion_read',
  availability: 'any',
  tool: createTool({
    description: `Read project discussions — threaded, multi-participant conversations that live under a project (separate from the task board and private chat).

OPERATIONS:
• 'list': List a project's discussions, newest activity first. Filter by category or status.
• 'get': Fetch a single discussion's metadata (title, category, status, linked task).
• 'get_messages': Read the full message transcript of a discussion.

Use this to catch up on an open question or decision before replying with discussion_write.`,
    inputSchema: discussionReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'list') {
        const discussions = await ctx.runQuery(
          internal.discussions.internal_queries.listProjectDiscussionsInternal,
          {
            organizationId,
            projectId: toId<'projects'>(args.projectId),
            category: args.category,
            status: args.status,
            limit: args.limit,
          },
        );
        return { operation: 'list', discussions };
      }

      if (args.operation === 'get') {
        const discussion = await ctx.runQuery(
          internal.discussions.internal_queries.getDiscussionInternal,
          { organizationId, threadId: args.threadId },
        );
        return { operation: 'get', discussion };
      }

      // operation === 'get_messages'
      const { messages } = await ctx.runQuery(
        internal.threads.internal_queries.getThreadMessagesInternal,
        { threadId: args.threadId, callerOrgId: organizationId },
      );
      return { operation: 'get_messages', messages };
    },
  }),
} as const;
