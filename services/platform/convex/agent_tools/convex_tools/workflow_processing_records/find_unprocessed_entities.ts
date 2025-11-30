/**
 * Convex Tool: Find Unprocessed Entities
 *
 * Find entities (customers, products) that haven't been processed by a specific workflow
 * within a given time window. Uses flattened key: metadata["workflow_${workflowId}_lastProcessedAt"].
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { ActionCtx } from '../../../_generated/server';
// Avoid importing the heavy typed `internal` directly to prevent deep type instantiation.
import type { FunctionReference } from 'convex/server';
import { internal } from '../../../_generated/api';

export const findUnprocessedEntitiesTool = {
  name: 'find_unprocessed_entities',
  tool: createTool({
    description: `Find entities that haven't been processed by a specific workflow within a time window.

This tool searches for entities where:
1. metadata["workflow_<workflowId>_lastProcessedAt"] is missing (never processed), OR
2. metadata["workflow_<workflowId>_lastProcessedAt"] is older than daysBack days ago

Returns up to 'limit' entities (default: 1).

IMPORTANT - RETURNED ENTITY STRUCTURE:
Each entity object contains TWO critical ID fields:
1. **_id**: The Convex platform ID (e.g., "jh7abc123...") - USE THIS for all update operations
2. **externalId**: The third-party platform ID (e.g., "cus_ZmD15h0vx4xk5m" from Circuly) - For reference only

Additional fields:
- **source**: Data source platform ("circuly", "manual_import", "file_upload")
- **name**, **email**, **phone**: Entity contact information
- **metadata**: Additional data from third-party platforms

CRITICAL: Always use the _id field (Convex ID) for update_customer/update_product and mark_entity_processed operations.
The externalId is only for reference and tracking the source platform.`,
    args: z.object({
      entityType: z
        .enum(['customers', 'products'])
        .default('customers')
        .describe('Type of entity to search for (customers or products)'),
      workflowId: z
        .string()
        .describe(
          'Workflow ID to check (e.g., "assess-customer-status"). Used to check metadata["workflow_<workflowId>_lastProcessedAt"]',
        ),
      daysBack: z
        .number()
        .min(1)
        .max(365)
        .default(3)
        .describe(
          'Number of days to look back. Entities processed within this window will be excluded.',
        ),
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(1)
        .describe('Maximum number of entities to return (default: 1)'),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      entities: unknown[];
      count: number;
      searchCriteria: {
        entityType: string;
        workflowId: string;
        daysBack: number;
        backoffHours: number;
      };
    }> => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Get organizationId from context
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for find_unprocessed_entities',
        );
      }

      // Calculate backoff hours from daysBack
      const backoffHours = args.daysBack * 24;

      console.log('[find_unprocessed_entities] Searching for entities', {
        entityType: args.entityType,
        workflowId: args.workflowId,
        daysBack: args.daysBack,
        backoffHours,
        organizationId,
        metadataKey: `workflow_${args.workflowId}_lastProcessedAt`,
      });

      // Query for unprocessed entities using the generic function with a shallowly typed reference
      type FindUnprocessedArgs = {
        organizationId: string;
        tableName: 'customers' | 'products';
        workflowId: string;
        backoffHours: number;
        limit?: number;
      };
      type FindUnprocessedResult = { documents: unknown[]; count: number };
      type ShallowInternal = {
        workflow_processing_records: {
          findUnprocessed: FunctionReference<
            'query',
            'internal',
            FindUnprocessedArgs,
            FindUnprocessedResult
          >;
        };
      };
      const findUnprocessedRef =
        internal.workflow_processing_records.findUnprocessed;
      const genericResult: FindUnprocessedResult = await actionCtx.runQuery(
        findUnprocessedRef,
        {
          organizationId,
          tableName: args.entityType,
          workflowId: args.workflowId,
          backoffHours,
          limit: args.limit,
        },
      );

      // Convert to expected format
      const result = {
        entities: genericResult.documents,
        count: genericResult.count,
      };

      console.log('[find_unprocessed_entities] Search completed', {
        entitiesFound: result.count,
        entityType: args.entityType,
        workflowId: args.workflowId,
      });

      return {
        entities: result.entities,
        count: result.count,
        searchCriteria: {
          entityType: args.entityType,
          workflowId: args.workflowId,
          daysBack: args.daysBack,
          backoffHours,
        },
      };
    },
  }),
} as const satisfies ToolDefinition;
