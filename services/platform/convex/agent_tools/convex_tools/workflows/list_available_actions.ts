/**
 * List Available Actions Tool
 *
 * Returns all available action types that can be used in workflow steps,
 * with their parameters, operations, and descriptions.
 *
 * This tool extracts detailed information from the action registry including:
 * - All available operations for each action
 * - Required and optional parameters
 * - Parameter types and descriptions
 * - Usage examples
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { ACTION_REFERENCE } from './action_reference';

export const listAvailableActionsTool = {
  name: 'list_available_actions' as const,
  tool: createTool({
    description:
      'List all available action types that can be used in workflow action steps. ' +
      'Available actions: customer, product, conversation, document, send_email, ' +
      'approval, workflow_processing_records, email_provider, imap, shopify, ' +
      'circuly, integrations, rag, crawler, website, websitePages, onedrive, ' +
      'tone_of_voice, set_variables. ' +
      'Returns action types, their operations, parameters, and descriptions. Use this to discover what actions are available when building workflows.',
    args: z.object({
      action: z
        .string()
        .optional()
        .describe(
          'Optional action type filter. Must be one of: customer, product, conversation, document, send_email, approval, workflow_processing_records, email_provider, imap, shopify, circuly, integrations, rag, crawler, website, websitePages, onedrive, tone_of_voice, set_variables. If provided, only that action is returned.',
        ),
    }),
    handler: async (_ctx, args) => {
      const filteredActions =
        args.action != null
          ? ACTION_REFERENCE.filter((a) => a.type === args.action)
          : ACTION_REFERENCE;

      // Format actions with detailed operation information
      const actionsWithDetails = filteredActions.map((action) => ({
        type: action.type,
        title: action.title,
        description: action.description,
        operations: action.operations.map((op) => ({
          operation: op.operation,
          description: op.description,
          requiredParams: op.requiredParams,
          optionalParams: op.optionalParams,
          example: op.example,
        })),
      }));

      // Also expose a JSON-catalog-style view keyed by action type,
      // similar to the structure documented for LLM prompts.
      const catalogByActionType = Object.fromEntries(
        actionsWithDetails.map((action) => [
          action.type,
          {
            // Heuristic: if any operation requires an "operation" param,
            // treat this action as operation-based.
            usesOperationField: action.operations.some((op) =>
              op.requiredParams.includes('operation'),
            ),
            operations: Object.fromEntries(
              action.operations.map((op) => [
                op.operation,
                {
                  required: op.requiredParams,
                  optional: op.optionalParams,
                },
              ]),
            ),
          },
        ]),
      );

      return {
        totalActions: actionsWithDetails.length,
        actions: actionsWithDetails,
        catalogByActionType,
        usage:
          'Each action has multiple operations. Use the "action" field for the action type and "operation" field (if applicable) for the specific operation. Check requiredParams and optionalParams for each operation. To get details for a single action, pass the tool arg "action". For a JSON-style catalog keyed by action type, use catalogByActionType.',
      };
    },
  }),
} as const satisfies ToolDefinition;

// NOTE: The detailed operation and parameter information now comes from
// ACTION_REFERENCE in ./action_reference. The old extractActionInfo helper
// is no longer needed and has been removed.

// Legacy helper left here for reference; categorization now comes from
// ACTION_REFERENCE entries directly.

// Legacy examples kept in docs; operation-specific examples now live in
// ACTION_REFERENCE and are returned directly from this tool.
