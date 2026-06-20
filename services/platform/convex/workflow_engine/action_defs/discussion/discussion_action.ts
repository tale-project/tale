/**
 * Discussion workflow action — lets automations participate in project
 * discussions (open, reply, set status, spawn a task) and read them. Attributes
 * writes to the `workflow` actor via `discussions/internal_mutations.ts`, which
 * enforces org scope and the agent-reply loop guard.
 *
 * The headline use: a `react-to-discussion-mention` workflow triggers on
 * `discussion.mentioned`, runs the mentioned agent (the `agent` action), then
 * posts its answer back with `reply`. Mirrors `task_action.ts`.
 */

import { type Infer, v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

const WORKFLOW_ACTOR_ID = 'workflow';

const discussionStatusValidator = v.union(
  v.literal('open'),
  v.literal('resolved'),
  v.literal('locked'),
);

// Derived from the validator so the param type stays in lockstep with what the
// `parametersValidator` accepts.
type DiscussionStatus = Infer<typeof discussionStatusValidator>;

type DiscussionActionParams =
  | {
      operation: 'open';
      projectId: string;
      title: string;
      message: string;
      category?: string;
    }
  | {
      operation: 'reply';
      threadId: string;
      message: string;
    }
  | {
      operation: 'set_status';
      threadId: string;
      status: DiscussionStatus;
    }
  | {
      operation: 'spawn_task';
      threadId: string;
      projectId: string;
      title: string;
      description?: string;
    }
  | {
      operation: 'list';
      projectId: string;
      category?: string;
      status?: DiscussionStatus;
      limit?: number;
    }
  | {
      operation: 'get';
      threadId: string;
    }
  | {
      operation: 'get_messages';
      threadId: string;
    };

export const discussionAction: ActionDefinition<DiscussionActionParams> = {
  type: 'discussion',
  title: 'Discussion Operation',
  description:
    'Participate in and read project discussions (open, reply, set_status, spawn_task, list, get, get_messages). Mirrors the agent discussion_read/discussion_write tools, so automations have the same discussion control as agents. Writes attribute to the workflow actor; @mentions in a reply route to the mentioned agent. organizationId is read from workflow context variables.',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('open'),
      projectId: v.id('projects'),
      title: v.string(),
      message: v.string(),
      category: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('reply'),
      threadId: v.string(),
      message: v.string(),
    }),
    v.object({
      operation: v.literal('set_status'),
      threadId: v.string(),
      status: discussionStatusValidator,
    }),
    v.object({
      operation: v.literal('spawn_task'),
      threadId: v.string(),
      projectId: v.id('projects'),
      title: v.string(),
      description: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('list'),
      projectId: v.id('projects'),
      category: v.optional(v.string()),
      status: v.optional(discussionStatusValidator),
      limit: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('get'),
      threadId: v.string(),
    }),
    v.object({
      operation: v.literal('get_messages'),
      threadId: v.string(),
    }),
  ),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'discussion action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'open': {
        const result = await ctx.runMutation(
          internal.discussions.internal_mutations.agentOpenDiscussion,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            projectId: toId<'projects'>(params.projectId),
            title: params.title,
            message: params.message,
            category: params.category,
          },
        );
        return { operation: 'open', ...result };
      }

      case 'reply': {
        const result = await ctx.runMutation(
          internal.discussions.internal_mutations.agentReplyToDiscussion,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            threadId: params.threadId,
            message: params.message,
          },
        );
        return { operation: 'reply', ...result };
      }

      case 'set_status': {
        await ctx.runMutation(
          internal.discussions.internal_mutations.agentSetDiscussionStatus,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            threadId: params.threadId,
            status: params.status,
          },
        );
        return { operation: 'set_status', status: params.status };
      }

      case 'spawn_task': {
        const result = await ctx.runMutation(
          internal.discussions.internal_mutations.agentSpawnTaskFromDiscussion,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            threadId: params.threadId,
            projectId: toId<'projects'>(params.projectId),
            title: params.title,
            description: params.description,
          },
        );
        return { operation: 'spawn_task', ...result };
      }

      case 'list': {
        const discussions = await ctx.runQuery(
          internal.discussions.internal_queries.listProjectDiscussionsInternal,
          {
            organizationId,
            projectId: toId<'projects'>(params.projectId),
            category: params.category,
            status: params.status,
            limit: params.limit,
          },
        );
        return { operation: 'list', discussions };
      }

      case 'get': {
        const discussion = await ctx.runQuery(
          internal.discussions.internal_queries.getDiscussionInternal,
          { organizationId, threadId: params.threadId },
        );
        return { operation: 'get', discussion };
      }

      case 'get_messages': {
        const { messages } = await ctx.runQuery(
          internal.threads.internal_queries.getThreadMessagesInternal,
          { threadId: params.threadId, callerOrgId: organizationId },
        );
        return { operation: 'get_messages', messages };
      }

      default: {
        const unhandled: never = params;
        throw new Error(
          `Unsupported discussion operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
