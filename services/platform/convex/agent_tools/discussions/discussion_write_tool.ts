/**
 * Convex Tool: Discussion Write
 *
 * Lets an agent participate in project discussions: open one, post a reply,
 * resolve/lock it, or spawn a task from it. All writes attribute to the acting
 * agent via `discussions/internal_mutations.ts`, which re-enforces org scope
 * and the agent-reply loop guard. @mentioning a teammate or agent in a reply
 * routes it to them (the `react-to-discussion-mention` workflow).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import {
  requireOrganizationId,
  resolveActorId,
} from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const discussionWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('open'),
    projectId: z
      .string()
      .describe('Convex Id<"projects"> the discussion belongs to'),
    title: z.string().describe('Short discussion title'),
    message: z
      .string()
      .describe(
        'Opening post body. Use @handle to mention a teammate or agent.',
      ),
    category: z
      .string()
      .optional()
      .describe(
        'general (default) / qa / ideas / decisions / announcements / show-and-tell / polls',
      ),
  }),
  z.object({
    operation: z.literal('reply'),
    threadId: z.string().describe('Discussion thread to reply in'),
    message: z
      .string()
      .describe(
        'Reply body. @mention a teammate or agent to route it to them.',
      ),
  }),
  z.object({
    operation: z.literal('set_status'),
    threadId: z.string(),
    status: z
      .enum(['open', 'resolved', 'locked'])
      .describe('resolved closes the question; locked stops further replies'),
  }),
  z.object({
    operation: z.literal('spawn_task'),
    threadId: z.string().describe('Source discussion'),
    projectId: z.string().describe('Project to create the task in'),
    title: z.string(),
    description: z.string().optional(),
  }),
]);

export const discussionWriteTool: ToolDefinition = {
  name: 'discussion_write',
  availability: 'any',
  tool: createTool({
    description: `Participate in project discussions (threaded, multi-participant conversations under a project).

OPERATIONS:
• 'open': Start a new discussion with an opening post. @mention an agent to pull them in.
• 'reply': Post a reply. @mention a teammate/agent to route it to them. Returns { posted: false, reason } if the discussion is locked or the agent-reply chain is too deep — stop in that case.
• 'set_status': resolve (answered/decided), reopen, or lock (no more replies) a discussion.
• 'spawn_task': Turn a discussion into a task on the board, with a bidirectional link.

Prefer discussions for decisions, design questions, and announcements; use the task board for trackable work.`,
    inputSchema: discussionWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);
      const actorId = resolveActorId(ctx);

      if (args.operation === 'open') {
        const result = await ctx.runMutation(
          internal.discussions.internal_mutations.agentOpenDiscussion,
          {
            organizationId,
            actorId,
            projectId: toId<'projects'>(args.projectId),
            title: args.title,
            message: args.message,
            category: args.category,
          },
        );
        return { operation: 'open', ...result };
      }

      if (args.operation === 'reply') {
        const result = await ctx.runMutation(
          internal.discussions.internal_mutations.agentReplyToDiscussion,
          {
            organizationId,
            actorId,
            threadId: args.threadId,
            message: args.message,
          },
        );
        return { operation: 'reply', ...result };
      }

      if (args.operation === 'set_status') {
        await ctx.runMutation(
          internal.discussions.internal_mutations.agentSetDiscussionStatus,
          {
            organizationId,
            actorId,
            threadId: args.threadId,
            status: args.status,
          },
        );
        return { operation: 'set_status', status: args.status };
      }

      // operation === 'spawn_task'
      const result = await ctx.runMutation(
        internal.discussions.internal_mutations.agentSpawnTaskFromDiscussion,
        {
          organizationId,
          actorId,
          threadId: args.threadId,
          projectId: toId<'projects'>(args.projectId),
          title: args.title,
          description: args.description,
        },
      );
      return { operation: 'spawn_task', ...result };
    },
  }),
} as const;
