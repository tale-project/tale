/**
 * Helper to read all historical versions of a workflow with their steps
 */

import type { ToolCtx } from '@convex-dev/agent';

import type { Doc } from '../../../_generated/dataModel';
import type {
  WorkflowReadListVersionHistoryResult,
  WorkflowVersionWithSteps,
} from './types';

import { internal } from '../../../_generated/api';

export interface ReadVersionHistoryArgs {
  workflowName: string;
  includeSteps?: boolean;
}

export async function readVersionHistory(
  ctx: ToolCtx,
  args: ReadVersionHistoryArgs,
): Promise<WorkflowReadListVersionHistoryResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    return {
      operation: 'list_version_history',
      totalVersions: 0,
      versions: [],
      message:
        'No organizationId in context - cannot list version history. This tool requires organizationId to be set.',
    };
  }

  try {
    // Get all versions of the workflow
    const allVersions: Doc<'wfDefinitions'>[] = await ctx.runQuery(
      internal.wf_definitions.internal_queries.listVersionsByName,
      {
        organizationId,
        name: args.workflowName,
      },
    );

    if (allVersions.length === 0) {
      return {
        operation: 'list_version_history',
        totalVersions: 0,
        versions: [],
        message: `No versions found for workflow "${args.workflowName}".`,
      };
    }

    const includeSteps = args.includeSteps ?? false;

    // Build version history with optional steps
    const versions: WorkflowVersionWithSteps[] = await Promise.all(
      allVersions.map(async (wf) => {
        let steps: Doc<'wfStepDefs'>[] | undefined;

        if (includeSteps) {
          steps = await ctx.runQuery(
            internal.wf_step_defs.internal_queries.listWorkflowSteps,
            {
              wfDefinitionId: wf._id,
            },
          );
        }

        return {
          workflowId: wf._id,
          name: wf.name,
          description: wf.description,
          version: wf.version,
          versionNumber: wf.versionNumber,
          status: wf.status,
          publishedAt: wf.publishedAt,
          publishedBy: wf.publishedBy,
          changeLog: wf.changeLog,
          stepCount: steps?.length,
          steps,
        };
      }),
    );

    return {
      operation: 'list_version_history',
      totalVersions: versions.length,
      versions,
      message: `Found ${versions.length} version(s) for workflow "${args.workflowName}".`,
    };
  } catch (error) {
    return {
      operation: 'list_version_history',
      totalVersions: 0,
      versions: [],
      error: `Failed to list version history: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
