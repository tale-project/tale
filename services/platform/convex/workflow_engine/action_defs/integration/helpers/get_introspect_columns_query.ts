/**
 * Get introspection query for listing columns in a table
 */

import type { SqlEngine } from '../../../../integrations/types';

export function getIntrospectColumnsQuery(
  engine: SqlEngine,
  schemaName: string,
  tableName: string,
): { query: string; params: Record<string, unknown> } {
  switch (engine) {
    case 'mssql':
      return {
        query: `
          SELECT
            COLUMN_NAME as columnName,
            DATA_TYPE as dataType,
            IS_NULLABLE as isNullable,
            COLUMN_DEFAULT as columnDefault,
            CHARACTER_MAXIMUM_LENGTH as maxLength
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @schemaName
            AND TABLE_NAME = @tableName
          ORDER BY ORDINAL_POSITION
        `,
        params: { schemaName, tableName },
      };

    case 'postgres':
      return {
        query: `
          SELECT
            column_name as "columnName",
            data_type as "dataType",
            is_nullable as "isNullable",
            column_default as "columnDefault",
            character_maximum_length as "maxLength"
          FROM information_schema.columns
          WHERE table_schema = $1
            AND table_name = $2
          ORDER BY ordinal_position
        `,
        params: { schemaName, tableName },
      };

    case 'mysql':
      return {
        query: `
          SELECT
            COLUMN_NAME as columnName,
            DATA_TYPE as dataType,
            IS_NULLABLE as isNullable,
            COLUMN_DEFAULT as columnDefault,
            CHARACTER_MAXIMUM_LENGTH as maxLength
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION
        `,
        params: { schemaName, tableName },
      };

    default: {
      const _exhaustiveCheck: never = engine;
      throw new Error(`Unsupported SQL engine: ${_exhaustiveCheck}`);
    }
  }
}
