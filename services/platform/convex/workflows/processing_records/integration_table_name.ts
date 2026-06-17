/**
 * Integration table names for workflow processing records.
 *
 * External data sources (SQL/REST integrations) have no Convex table, so the
 * dedupe rows in `workflowProcessingRecords` use a synthetic tableName of the
 * form `integration:<integrationName>:<sourceIdentifier>` (e.g.
 * `integration:shopify:orders`). This needs no schema change — `tableName` is
 * a plain string in the schema and the `by_record` index works unchanged.
 */

export const INTEGRATION_TABLE_PREFIX = 'integration';

/**
 * Reserved recordId for the per-workflow sync-state sentinel row that stores
 * the incremental watermark/cursor for an integration data source.
 *
 * Every integration-path read over `workflowProcessingRecords` MUST exclude
 * this recordId — it is bookkeeping, not a processed external record.
 */
export const SYNC_STATE_RECORD_ID = '__sync_state__';

export type IntegrationTableName = `integration:${string}:${string}`;

export interface ParsedIntegrationTableName {
  integrationName: string;
  sourceIdentifier: string;
}

function validateTableNamePart(value: string, label: string): void {
  if (!value || value.trim() === '') {
    throw new Error(
      `Integration table name requires a non-empty ${label} (got "${value}")`,
    );
  }
  if (value.includes(':')) {
    throw new Error(
      `Integration table name ${label} must not contain ":" (got "${value}")`,
    );
  }
}

export function createIntegrationTableName(
  integrationName: string,
  sourceIdentifier: string,
): IntegrationTableName {
  validateTableNamePart(integrationName, 'integrationName');
  validateTableNamePart(sourceIdentifier, 'sourceIdentifier');
  return `${INTEGRATION_TABLE_PREFIX}:${integrationName}:${sourceIdentifier}`;
}

export function parseIntegrationTableName(
  tableName: string,
): ParsedIntegrationTableName | null {
  const parts = tableName.split(':');
  if (parts.length !== 3 || parts[0] !== INTEGRATION_TABLE_PREFIX) {
    return null;
  }
  const [, integrationName, sourceIdentifier] = parts;
  if (!integrationName || !sourceIdentifier) {
    return null;
  }
  return { integrationName, sourceIdentifier };
}

export function isIntegrationTableName(
  tableName: string,
): tableName is IntegrationTableName {
  return parseIntegrationTableName(tableName) !== null;
}
