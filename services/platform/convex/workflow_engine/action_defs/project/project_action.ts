/**
 * Project workflow action — lets automations create and update projects (the
 * containers tasks + discussions live in). Dispatches to the agent-facing
 * internal project mutations, attributing the change to the `workflow` actor.
 * Mirrors `task_action.ts`.
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

const WORKFLOW_ACTOR_ID = 'workflow';

type ProjectActionParams =
  | {
      operation: 'create';
      name: string;
      description?: string;
      instructions?: string;
    }
  | {
      operation: 'update';
      projectId: string;
      name?: string;
      description?: string;
      instructions?: string;
    }
  | {
      operation: 'list';
      includeArchived?: boolean;
    }
  | {
      operation: 'get';
      projectId: string;
    };

export const projectAction: ActionDefinition<ProjectActionParams> = {
  type: 'project',
  title: 'Project Operation',
  description:
    'Create, update, and read projects (the containers that group tasks and discussions). Mirrors the agent project_read/project_write tools, so automations have the same project control as agents. organizationId is read from workflow context variables.',
  parametersValidator: v.union(
    v.object({
      operation: v.literal('create'),
      name: v.string(),
      description: v.optional(v.string()),
      instructions: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('update'),
      projectId: v.id('projects'),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      instructions: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('list'),
      includeArchived: v.optional(v.boolean()),
    }),
    v.object({
      operation: v.literal('get'),
      projectId: v.id('projects'),
    }),
  ),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Error(
        'project action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentCreateProject,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            name: params.name,
            description: params.description,
            instructions: params.instructions,
          },
        );
        return { operation: 'create', ...result };
      }

      case 'update': {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentUpdateProject,
          {
            organizationId,
            actorId: WORKFLOW_ACTOR_ID,
            projectId: toId<'projects'>(params.projectId),
            name: params.name,
            description: params.description,
            instructions: params.instructions,
          },
        );
        return { operation: 'update', ...result };
      }

      case 'list': {
        const projects = await ctx.runQuery(
          internal.tasks.internal_queries.listProjectsForAgent,
          { organizationId, includeArchived: params.includeArchived },
        );
        return { operation: 'list', projects };
      }

      case 'get': {
        const project = await ctx.runQuery(
          internal.tasks.internal_queries.getProjectByIdInternal,
          { projectId: toId<'projects'>(params.projectId), organizationId },
        );
        return { operation: 'get', project };
      }

      default: {
        const unhandled: never = params;
        throw new Error(
          `Unsupported project operation: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  },
};
