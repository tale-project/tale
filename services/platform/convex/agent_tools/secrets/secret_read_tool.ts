/**
 * Convex Tool: Secret Read (metadata only)
 *
 * Lets an agent DISCOVER which project secrets exist — names + descriptions +
 * last-updated only. It NEVER returns ciphertext or plaintext. Secret values
 * reach an external service exclusively via server-side `{{secret}}` injection
 * in the runtime dispatch builder. Every access is recorded in the
 * `agentSecretAccess` ledger.
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

const secretReadArgs = z.object({
  operation: z.literal('list_for_project'),
  projectId: z
    .string()
    .describe('Convex Id<"projects"> to list secret names for'),
});

export const secretReadTool: ToolDefinition = {
  name: 'secret_read',
  tool: createTool({
    description: `List the NAMES of secrets configured on a project (metadata only — names, descriptions, last-updated).

This tool NEVER returns secret values. To USE a secret, reference it by name when dispatching work to a runtime; the platform injects the value server-side and it is never exposed to you. Use this only to discover which credentials a project has available (e.g. is there a 'GITHUB_PAT' or 'OPENCLAW_API_KEY').`,
    inputSchema: secretReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);
      const projectId = toId<'projects'>(args.projectId);

      const secrets = await ctx.runQuery(
        internal.projects.secrets.internal.listProjectSecretMetaInternal,
        { organizationId, projectId },
      );

      await ctx.runMutation(
        internal.projects.secrets.internal.logAgentSecretAccessInternal,
        {
          organizationId,
          projectId,
          secretName: '*',
          agentSlug: resolveActorId(ctx),
          accessType: 'metadata_read',
          decision: 'auto',
        },
      );

      return { operation: 'list_for_project', secrets };
    },
  }),
} as const;
