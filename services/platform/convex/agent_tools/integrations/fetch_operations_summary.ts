/**
 * Fetch a concise operations summary for a bound integration tool.
 *
 * Queries the integration from DB, extracts its operations,
 * and returns a compact multi-line string for embedding in a tool description.
 */

import type { ActionCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
import { isSqlIntegration } from '../../integrations/helpers';
import { getPredefinedIntegration } from '../../predefined_integrations';

interface OperationInfo {
  name: string;
  title?: string;
  operationType?: 'read' | 'write';
  requiresApproval?: boolean;
  parametersSchema?: Record<string, unknown>;
}

/**
 * Fetch integration operations and return a concise summary string.
 *
 * Returns undefined if the integration is not found.
 */
export async function fetchOperationsSummary(
  ctx: ActionCtx,
  organizationId: string,
  integrationName: string,
): Promise<string | undefined> {
  const integration = await ctx.runQuery(
    internal.integrations.internal_queries.getByName,
    { organizationId, name: integrationName },
  );

  if (!integration) {
    return undefined;
  }

  const operations: OperationInfo[] = [];

  if (isSqlIntegration(integration)) {
    for (const op of integration.sqlOperations) {
      operations.push({
        name: op.name,
        title: op.title,
        operationType: op.operationType,
        requiresApproval: op.requiresApproval,
      });
    }
  } else {
    let connectorConfig = integration.connector;

    if (!connectorConfig) {
      const predefined = getPredefinedIntegration(integrationName);
      if (predefined) {
        connectorConfig = predefined.connector;
      }
    }

    if (connectorConfig?.operations) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic connector schema
      const ops = connectorConfig.operations as Array<{
        name: string;
        title?: string;
        operationType?: 'read' | 'write';
        parametersSchema?: Record<string, unknown>;
      }>;
      for (const op of ops) {
        operations.push({
          name: op.name,
          title: op.title,
          operationType: op.operationType,
          parametersSchema: op.parametersSchema,
        });
      }
    }
  }

  if (operations.length === 0) {
    return undefined;
  }

  return formatOperationsSummary(operations);
}

function formatOperationsSummary(operations: OperationInfo[]): string {
  const lines = ['Available operations:'];

  for (const op of operations) {
    const parts: string[] = [op.name];

    const tags: string[] = [];
    if (op.operationType) {
      tags.push(op.operationType);
    }
    if (op.requiresApproval) {
      tags.push('requires approval');
    }
    if (tags.length > 0) {
      parts.push(`(${tags.join(', ')})`);
    }

    if (op.title) {
      parts.push(`- ${op.title}`);
    }

    lines.push(`  ${parts.join(' ')}`);

    if (op.parametersSchema) {
      const paramLines = formatParametersSchema(op.parametersSchema);
      if (paramLines) {
        lines.push(paramLines);
      }
    }
  }

  return lines.join('\n');
}

function formatParametersSchema(
  schema: Record<string, unknown>,
): string | undefined {
  const properties = schema.properties;
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return undefined;
  }

  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return undefined;
  }

  const paramParts: string[] = [];
  for (const [name, rawProp] of entries) {
    if (!rawProp || typeof rawProp !== 'object') continue;
    const propType = 'type' in rawProp ? rawProp.type : undefined;
    const propRequired = 'required' in rawProp ? rawProp.required : undefined;
    const propDesc = 'description' in rawProp ? rawProp.description : undefined;
    const type = typeof propType === 'string' ? propType : 'unknown';
    const required = propRequired === true ? 'required' : 'optional';
    const desc = typeof propDesc === 'string' ? ` - ${propDesc}` : '';
    paramParts.push(`      ${name} (${type}, ${required})${desc}`);
  }

  if (paramParts.length === 0) {
    return undefined;
  }

  return `    params:\n${paramParts.join('\n')}`;
}
