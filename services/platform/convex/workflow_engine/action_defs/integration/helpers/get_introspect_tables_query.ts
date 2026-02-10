/**
 * Get introspection query for listing tables
 */

import type { SqlEngine } from '../../../../integrations/types';

export function getIntrospectTablesQuery(engine: SqlEngine): string {
  switch (engine) {
    case 'mssql':
      return `
        SELECT
          TABLE_SCHEMA as schemaName,
          TABLE_NAME as tableName,
          TABLE_TYPE as tableType
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `;

    case 'postgres':
      return `
        SELECT
          table_schema as "schemaName",
          table_name as "tableName",
          table_type as "tableType"
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
      `;

    case 'mysql':
      return `
        SELECT
          TABLE_SCHEMA as schemaName,
          TABLE_NAME as tableName,
          TABLE_TYPE as tableType
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `;

    default: {
      const _exhaustiveCheck: never = engine;
      throw new Error(`Unsupported SQL engine: ${String(_exhaustiveCheck)}`);
    }
  }
}
