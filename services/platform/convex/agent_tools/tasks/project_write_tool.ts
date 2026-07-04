/**
 * Convex Tool: Project Write
 *
 * Lets an agent create and update projects (the containers tasks live in).
 * Org-scoped via `tasks/internal_mutations.ts`. Project deletion is NOT exposed
 * to agents (destructive, admin + approval-gated — a later milestone).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { requireOrganizationId, resolveActorId } from './helpers/context';

const projectWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    name: z.string().describe('Project name (≤ 80 chars)'),
    description: z.string().optional(),
    instructions: z
      .string()
      .optional()
      .describe('Optional project instructions injected into agent context'),
  }),
  z.object({
    operation: z.literal('update'),
    projectId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
  }),
]);

export const projectWriteTool: ToolDefinition = {
  name: 'project_write',
  availability: 'any',
  tool: createTool({
    description: `Create and update projects (the containers that group tasks).

OPERATIONS:
• 'create': Create a new project to organize tasks.
• 'update': Update a project's name, description, or instructions.`,
    inputSchema: projectWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);
      const actorId = resolveActorId(ctx);

      if (args.operation === 'create') {
        const result = await ctx.runMutation(
          internal.tasks.internal_mutations.agentCreateProject,
          {
            organizationId,
            actorId,
            name: args.name,
            description: args.description,
            instructions: args.instructions,
          },
        );
        return { operation: 'create', ...result };
      }

      const result = await ctx.runMutation(
        internal.tasks.internal_mutations.agentUpdateProject,
        {
          organizationId,
          actorId,
          projectId: toId<'projects'>(args.projectId),
          name: args.name,
          description: args.description,
          instructions: args.instructions,
        },
      );
      return { operation: 'update', ...result };
    },
  }),
} as const;
