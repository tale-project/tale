import type { ToolCtx } from '@convex-dev/agent';

import type { WorkflowJsonConfig } from '../../../../lib/shared/schemas/workflows';
import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { resolveOrgSlug } from '../../../organizations/resolve_org_slug';
import type { WorkflowReadGetStructureResult } from './types';

export async function readWorkflowStructure(
  ctx: ToolCtx,
  args: { workflowSlug: string; organizationId: string },
): Promise<WorkflowReadGetStructureResult> {
  try {
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const result: unknown = await ctx.runAction(
      internal.workflows.file_actions.readWorkflowForExecution,
      { orgSlug, workflowSlug: args.workflowSlug },
    );

    if (!isRecord(result)) {
      return {
        operation: 'get_structure',
        slug: args.workflowSlug,
        config: null,
        error: 'Unexpected response from file system',
      };
    }

    if (result.ok !== true) {
      return {
        operation: 'get_structure',
        slug: args.workflowSlug,
        config: null,
        message:
          typeof result.message === 'string'
            ? result.message
            : `Workflow "${args.workflowSlug}" not found.`,
      };
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig
    const config = result.config as WorkflowJsonConfig;
    const hash = typeof result.hash === 'string' ? result.hash : undefined;

    return {
      operation: 'get_structure',
      slug: args.workflowSlug,
      config,
      hash,
      message: `Workflow "${config.name}" has ${config.steps.length} step(s).`,
    };
  } catch (error) {
    return {
      operation: 'get_structure',
      slug: args.workflowSlug,
      config: null,
      error: `Failed to read workflow: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
