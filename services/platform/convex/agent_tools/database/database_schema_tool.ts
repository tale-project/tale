/**
 * Convex Tool: Database Schema
 *
 * Allows the workflow assistant to introspect table schemas for writing
 * correct filterExpressions in workflow_processing_records operations.
 *
 * Operations:
 * - list_tables: List all tables available for workflow processing
 * - get_table_schema: Get filterable fields for a specific table
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';

import {
  JEXL_TRANSFORMS,
  type DatabaseSchemaListTablesResult,
  type DatabaseSchemaGetTableResult,
} from './helpers/types';
import { getSupportedTables, getTableSchema } from './helpers/schema_definitions';

const databaseSchemaArgs = z.object({
  operation: z
    .enum(['list_tables', 'get_table_schema'])
    .describe(
      "Operation: 'list_tables' to see all tables, 'get_table_schema' to get fields for a specific table",
    ),
  tableName: z
    .string()
    .optional()
    .describe(
      "Required for 'get_table_schema': table name (e.g., 'conversations', 'customers', 'approvals')",
    ),
});

export const databaseSchemaTool: ToolDefinition = {
  name: 'database_schema',
  tool: createTool({
    description: `Database schema introspection tool for writing filterExpressions.

USE THIS TOOL WHEN:
- Creating a workflow that uses workflow_processing_records.find_unprocessed with filterExpression
- Need to know what fields are available for filtering on a table
- Need to understand valid enum values (e.g., status values)
- Need examples of valid filterExpression syntax

OPERATIONS:
- 'list_tables': List all tables supported by workflow_processing_records
- 'get_table_schema': Get filterable fields, types, enum values, and examples for a specific table

EXAMPLE WORKFLOW:
1. Call list_tables to see available tables
2. Call get_table_schema with tableName='conversations' to see fields
3. Use the returned fields and examples to write a correct filterExpression

JEXL TRANSFORMS FOR DATETIME FIELDS:
- daysAgo(field): Returns number of days since the date
- hoursAgo(field): Returns number of hours since the date
- minutesAgo(field): Returns number of minutes since the date
- parseDate(field): Parses date string to timestamp
- isBefore(field, compareDate): Returns true if field is before compareDate
- isAfter(field, compareDate): Returns true if field is after compareDate

FILTER EXPRESSION EXAMPLES:
- Simple: status == "open"
- Multiple conditions: status == "closed" && priority == "high"
- With time transform: status == "closed" && daysAgo(metadata.resolved_at) > 30
- Check field exists: metadata.resolved_at && daysAgo(metadata.resolved_at) > 30`,

    args: databaseSchemaArgs,

    handler: async (
      _ctx,
      args,
    ): Promise<DatabaseSchemaListTablesResult | DatabaseSchemaGetTableResult> => {
      // Use the shared JEXL_TRANSFORMS constant for consistency
      const jexlTransforms = [...JEXL_TRANSFORMS];

      if (args.operation === 'list_tables') {
        return {
          operation: 'list_tables',
          tables: getSupportedTables(),
          jexlTransforms,
        };
      }

      // operation === 'get_table_schema'
      if (!args.tableName) {
        throw new Error(
          "Missing required 'tableName' for get_table_schema operation",
        );
      }

      const schema = getTableSchema(args.tableName);
      if (!schema) {
        const availableTables = getSupportedTables()
          .map((t) => t.name)
          .join(', ');
        throw new Error(
          `Unknown table '${args.tableName}'. Available tables: ${availableTables}`,
        );
      }

      return {
        operation: 'get_table_schema',
        tableName: schema.tableName,
        description: schema.description,
        filterableFields: schema.filterableFields,
        jexlTransforms,
        examples: schema.examples,
      };
    },
  }),
} as const;
