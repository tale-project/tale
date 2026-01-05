/**
 * Format integrations list for sub-agent context
 *
 * Provides a consistent format for integration information
 * that can be injected into sub-agent prompts.
 * Now includes operations list to eliminate introspect calls.
 */

import type { Doc } from '../../../_generated/dataModel';

type Integration = Doc<'integrations'>;

/** Summary of an operation for context injection */
interface OperationSummary {
  name: string;
  title?: string;
  description?: string;
  operationType?: 'read' | 'write';
  parametersSchema?: {
    properties?: Record<string, unknown>;
    type?: string;
  };
}

/**
 * Format a list of integrations into a string suitable for LLM context.
 * Includes operations list so sub-agent can directly call operations
 * without needing to introspect first.
 */
export function formatIntegrationsForContext(integrations: Integration[]): string {
  if (!integrations || integrations.length === 0) {
    return '';
  }

  return integrations
    .map((integration) => {
      const type = integration.type || 'rest_api';
      const status = integration.status || 'active';
      const title = integration.title || integration.name;
      const desc = integration.description ? ` - ${integration.description}` : '';

      // Basic info
      let result = `• ${integration.name} (${type}, ${status}): ${title}${desc}`;

      // Add operations list
      const operations = getOperationsFromIntegration(integration);
      if (operations.length > 0) {
        result += '\n  Operations:';
        for (const op of operations) {
          const opType = op.operationType ? ` [${op.operationType}]` : '';
          const opDesc = op.description ? `: ${op.description}` : '';
          result += `\n    - ${op.name}${opType}${opDesc}`;

          // Add parameter info if available
          if (op.parametersSchema?.properties) {
            const params = Object.keys(op.parametersSchema.properties);
            if (params.length > 0) {
              result += `\n      params: ${params.join(', ')}`;
            }
          }
        }
      }

      return result;
    })
    .join('\n\n');
}

/**
 * Extract operations from an integration document.
 * Handles both SQL and REST API integrations.
 */
function getOperationsFromIntegration(integration: Integration): OperationSummary[] {
  const type = integration.type ?? 'rest_api';

  if (type === 'sql') {
    // SQL integration - sqlOperations is defined on the integration schema
    const sqlOps = integration.sqlOperations ?? [];

    // Built-in introspection operations (always available for SQL)
    const introspectionOps: OperationSummary[] = [
      { name: 'introspect_tables', description: 'List all tables in the database' },
      { name: 'introspect_columns', description: 'Get columns for a specific table (params: schemaName, tableName)' },
    ];

    // Format user-defined SQL operations
    const userOps: OperationSummary[] = sqlOps.map((op) => ({
      name: op.name,
      title: op.title,
      description: op.description,
      operationType: op.operationType,
      parametersSchema: op.parametersSchema,
    }));

    return [...introspectionOps, ...userOps];
  }

  // REST API integration - connector is defined on the integration schema
  const connector = integration.connector;
  if (connector?.operations) {
    return connector.operations.map((op) => ({
      name: op.name,
      title: op.title,
      description: op.description,
      // operationType is not available on connector operations in schema
      parametersSchema: op.parametersSchema,
    }));
  }

  return [];
}
