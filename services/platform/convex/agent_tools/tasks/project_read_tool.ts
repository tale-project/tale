/**
 * Convex Tool: Project Read
 *
 * Read-only project operations for agents (list/get projects in the agent's
 * organization). Projects are the containers tasks live in.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import type { ToolDefinition } from '../types';
import { requireOrganizationId } from './helpers/context';

const projectReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list'),
    includeArchived: z.boolean().optional(),
  }),
  z.object({
    operation: z.literal('get_by_id'),
    projectId: z.string().describe('Convex Id<"projects">'),
  }),
]);

export const projectReadTool: ToolDefinition = {
  name: 'project_read',
  availability: 'any',
  tool: createTool({
    description: `Read projects (the containers that group tasks) in the organization.

OPERATIONS:
• 'list': List projects (optionally including archived). Use to discover which projects exist before creating tasks.
• 'get_by_id': Fetch one project's details (name, description, instructions).`,
    inputSchema: projectReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'get_by_id') {
        const project = await ctx.runQuery(
          internal.tasks.internal_queries.getProjectByIdInternal,
          { projectId: toId<'projects'>(args.projectId), organizationId },
        );
        return { operation: 'get_by_id', project };
      }

      const projects = await ctx.runQuery(
        internal.tasks.internal_queries.listProjectsForAgent,
        { organizationId, includeArchived: args.includeArchived },
      );
      return { operation: 'list', projects };
    },
  }),
} as const;
