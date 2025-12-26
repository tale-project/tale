/**
 * Convex Tool: Verify Approval
 *
 * Allows the AI to verify that an approval record actually exists in the database
 * before claiming it was created. This prevents hallucination of approval IDs.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';

const verifyApprovalArgs = z.object({
  approvalId: z
    .string()
    .describe(
      'The approval ID to verify (e.g., "j57d0wr5f91v3g3m1h7y2t3z9j17xy2b5"). This should be the ID returned from a previous integration tool call.',
    ),
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
    description: `Verify that an approval record exists in the database.

IMPORTANT: You MUST call this tool after creating a write operation approval to confirm it was actually created before telling the user about it.

This tool checks if an approval ID corresponds to a real approval record in the database. Use it to:
1. Confirm an approval was successfully created after calling a write operation
2. Verify the approval details (status, operation name, etc.)
3. Prevent reporting false approval IDs to users

REQUIRED WORKFLOW for write operations:
1. Call the integration tool with a write operation (e.g., update_guest, post_charge)
2. If the tool returns an approvalId, IMMEDIATELY call verify_approval with that ID
3. Only if verify_approval returns exists: true, inform the user about the approval
4. If verify_approval returns exists: false, report the error - do NOT claim an approval was created

Returns:
- exists: true/false - whether the approval exists
- status: 'pending', 'approved', or 'rejected' (if exists)
- operationName, operationTitle, integrationName: details about the approval (if exists)
- error: error message if the approval doesn't exist or verification failed`,

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
        const approval = await ctx.runQuery(
          internal.approvals.getApprovalInternal,
          {
            // Cast to Id<'approvals'> - the query will handle invalid IDs gracefully
            approvalId: approvalId as any,
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
        const metadata = approval.metadata as Record<string, unknown> | undefined;
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
