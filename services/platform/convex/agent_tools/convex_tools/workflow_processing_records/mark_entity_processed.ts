/**
 * Convex Tool: Mark Entity Processed
 *
 * Marks the entity as processed for a given workflow (processedAt ISO timestamp),
 * using existing internal mutation set_workflow_processed_at.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { FunctionReference } from 'convex/server';
import * as apiModule from '../../../_generated/api';

export const markEntityProcessedTool = {
  name: 'mark_entity_processed',
  tool: createTool({
    description: `Mark an entity (customer or product) as processed for a specific workflow by setting a processedAt timestamp.`,
    args: z.object({
      entityType: z.enum(['customers', 'products']).default('customers'),
      entityId: z.string().describe('Entity id to mark as processed'),
      workflowId: z.string().describe('Workflow key/id for tracking'),
      processedAtISO: z
        .string()
        .optional()
        .describe('Optional ISO timestamp, defaults to now'),
    }),
    handler: async (ctx, args) => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Get organizationId from context
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for mark_entity_processed',
        );
      }

      const processedAtISO = args.processedAtISO || new Date().toISOString();

      console.log('[mark_entity_processed] Marking entity as processed', {
        entityType: args.entityType,
        entityId: args.entityId,
        workflowId: args.workflowId,
        processedAtISO,
        organizationId,
      });

      // Get the entity to retrieve its _creationTime
      // Explicitly annotate the type to avoid deep generic inference issues (TS2589)
      let entity: { _creationTime: number } | null;
      if (args.entityType === 'customers') {
        entity = await actionCtx.runQuery(internal.customers.getCustomerById, {
          customerId: args.entityId as Id<'customers'>,
        });
      } else {
        entity = await actionCtx.runQuery(internal.products.getProductById, {
          productId: args.entityId as Id<'products'>,
        });
      }

      if (!entity) {
        throw new Error(
          `${args.entityType === 'customers' ? 'Customer' : 'Product'} not found`,
        );
      }
      // Shallow-typed reference to avoid outdated generated types until codegen runs
      type RecordProcessedArgs = {
        organizationId: string;
        tableName: 'customers' | 'products';
        documentId: string;
        workflowId: string;
        documentCreationTime: number;
        metadata?: unknown;
      };

      type ShallowInternalLib = {
        workflow_processing_records: {
          recordProcessed: FunctionReference<
            'mutation',
            'internal',
            RecordProcessedArgs,
            Id<'workflowProcessingRecords'>
          >;
        };
      };
      const recordProcessedRef = (
        apiModule as unknown as { internal: ShallowInternalLib }
      ).internal.workflow_processing_records.recordProcessed;

      // Use the generic recordProcessed function
      await actionCtx.runMutation(recordProcessedRef, {
        organizationId,
        tableName: args.entityType,
        documentId: args.entityId,
        workflowId: args.workflowId,
        documentCreationTime: (entity as { _creationTime: number })
          ._creationTime,
        metadata: {
          processedAtISO,
        },
      });

      console.log('[mark_entity_processed] Entity marked as processed', {
        entityType: args.entityType,
        entityId: args.entityId,
        workflowId: args.workflowId,
      });

      return {
        ok: true,
        entityType: args.entityType,
        entityId: args.entityId,
        workflowId: args.workflowId,
        processedAtISO,
      };
    },
  }),
} as const satisfies ToolDefinition;
