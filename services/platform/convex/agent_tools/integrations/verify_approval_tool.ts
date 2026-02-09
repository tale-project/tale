/**
 * Convex Tool: Verify Approval
 *
 * Allows the AI to verify that an approval record actually exists in the database
 * before claiming it was created. This prevents hallucination of approval IDs.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';
import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';

const verifyApprovalArgs = z.object({
  approvalId: z.string().describe('Approval ID returned from write operation'),
});

export interface VerifyApprovalResult {
  exists: boolean;
  approvalId: string;
  status?: 'pending' | 'approved' | 'rejected';
  operationName?: string;
  operationTitle?: string;
  integrationName?: string;
  error?: string;
}

export const verifyApprovalTool: ToolDefinition = {
  name: 'verify_approval',
  tool: createTool({
    description: `Verify an approval record exists.
Call after write operations to confirm approval was created.`,

    args: verifyApprovalArgs,

    handler: async (ctx: ToolCtx, args): Promise<VerifyApprovalResult> => {
      const { approvalId } = args;

      // Validate the approval ID format (Convex IDs start with specific prefixes)
      if (!approvalId || typeof approvalId !== 'string') {
        return {
          exists: false,
          approvalId: approvalId || '',
          error: 'Invalid approval ID: must be a non-empty string',
        };
      }

      try {
        // Query the approval from the database
        // The ID comes from LLM output, so we cast it to the expected type
        // The query will throw if the ID format is invalid
        const approval = await ctx.runQuery(
          internal.approvals.internal_queries.getApprovalById,
          {
            approvalId: approvalId as Id<'approvals'>,
          },
        );

        if (!approval) {
          console.warn(
            '[verify_approval] Approval not found - possible hallucination:',
            {
              approvalId,
            },
          );
          return {
            exists: false,
            approvalId,
            error: `Approval with ID "${approvalId}" does not exist in the database. The approval may not have been created successfully.`,
          };
        }

        // Extract metadata for integration operations
        const metadata = approval.metadata as
          | Record<string, unknown>
          | undefined;
        const operationName = metadata?.operationName as string | undefined;
        const operationTitle = metadata?.operationTitle as string | undefined;
        const integrationName = metadata?.integrationName as string | undefined;

        console.log('[verify_approval] Approval verified successfully:', {
          approvalId,
          status: approval.status,
          operationName,
          integrationName,
        });

        return {
          exists: true,
          approvalId,
          status: approval.status as 'pending' | 'approved' | 'rejected',
          operationName,
          operationTitle,
          integrationName,
        };
      } catch (error) {
        // Handle invalid ID format errors from Convex
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.error('[verify_approval] Verification failed:', {
          approvalId,
          error: errorMessage,
        });

        return {
          exists: false,
          approvalId,
          error: `Failed to verify approval: ${errorMessage}`,
        };
      }
    },
  }),
} as const;
