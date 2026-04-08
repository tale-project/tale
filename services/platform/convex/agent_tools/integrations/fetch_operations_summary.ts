/**
 * Fetch a concise operations summary for a bound integration tool.
 *
 * Queries the integration from DB, extracts its operations,
 * and returns a compact multi-line string for embedding in a tool description.
 */

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { isSqlIntegration } from '../../integrations/helpers';

export interface OperationInfo {
  name: string;
  title?: string;
  operationType?: 'read' | 'write';
  requiresApproval?: boolean;
  parametersSchema?: Record<string, unknown>;
}

/**
 * Fetch a concise operations summary string only (legacy wrapper).
 */
export async function fetchOperationsSummary(
  ctx: ActionCtx,
  organizationId: string,
  integrationName: string,
): Promise<string | undefined> {
  const result = await fetchOperationsWithSchema(
    ctx,
    organizationId,
    integrationName,
  );
  return result?.summary;
}

export interface FetchedOperations {
  summary: string;
  operations: OperationInfo[];
  /** Merged metadata: static config.json metadata + runtime connectionConfig values */
  metadata?: Record<string, unknown>;
}

/**
 * Fetch integration operations and return a concise summary string + raw operations.
 *
 * Returns undefined if the integration is not found.
 */
export async function fetchOperationsWithSchema(
  ctx: ActionCtx,
  organizationId: string,
  integrationName: string,
): Promise<FetchedOperations | undefined> {
  const integration = await ctx.runAction(
    internal.integrations.load_integration.loadIntegration,
    { orgSlug: 'default', organizationId, slug: integrationName },
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
    const connectorConfig = integration.connector;

    if (
      connectorConfig?.operations &&
      Array.isArray(connectorConfig.operations)
    ) {
      for (const rawOp of connectorConfig.operations) {
        const op = isRecord(rawOp) ? rawOp : undefined;
        if (!op) continue;
        const name = getString(op, 'name');
        if (!name) continue;
        operations.push({
          name,
          title: getString(op, 'title'),
          operationType:
            getString(op, 'operationType') === 'write' ? 'write' : 'read',
          parametersSchema: isRecord(op.parametersSchema)
            ? op.parametersSchema
            : undefined,
        });
      }
    }
  }

  if (operations.length === 0) {
    return undefined;
  }

  // Resolve {{variable}} placeholders in metadata string values
  // using connectionConfig as the variable source
  const rawMetadata = integration.metadata as
    | Record<string, unknown>
    | undefined;
  const metadata = rawMetadata
    ? resolveMetadataVariables(rawMetadata, integration.connectionConfig)
    : undefined;

  return {
    summary: formatOperationsSummary(operations),
    operations,
    metadata,
  };
}

/**
 * Replace `{{key}}` placeholders in metadata string values with
 * values from connectionConfig (e.g. `{{model}}` → `gpt-image-1`).
 */
function resolveMetadataVariables(
  metadata: Record<string, unknown>,
  connectionConfig: unknown,
): Record<string, unknown> {
  const vars =
    connectionConfig && typeof connectionConfig === 'object'
      ? (connectionConfig as Record<string, unknown>)
      : {};

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      resolved[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
        const v = vars[varName];
        return typeof v === 'string' ? v : `{{${varName}}}`;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
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
