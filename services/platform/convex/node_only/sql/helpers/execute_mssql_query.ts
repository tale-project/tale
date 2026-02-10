'use node';

/**
 * Execute MS SQL Server query
 */

import sql from 'mssql';

import type { SqlExecutionParams, SqlExecutionResult } from '../types';

import { toConvexJsonValue } from '../../../lib/type_cast_helpers';

/**
 * Extract all parameter names referenced in a SQL query (e.g., @paramName)
 */
function extractQueryParameters(query: string): string[] {
  // Match @paramName patterns, excluding @@systemVariables
  const paramRegex = /@([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\()/g;
  const params = new Set<string>();
  let match;

  while ((match = paramRegex.exec(query)) !== null) {
    // Skip system variables that start with @@
    if (!query.slice(match.index - 1, match.index).includes('@')) {
      params.add(match[1]);
    }
  }

  return Array.from(params);
}

/**
 * Convert Date objects to timestamps for Convex compatibility
 */
function convertDatesInData(
  data: Record<string, unknown>[],
): Record<string, unknown>[] {
  return data.map((row) => {
    const convertedRow: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) {
        // Convert Date to ISO string for Convex compatibility
        convertedRow[key] = value.getTime();
      } else {
        convertedRow[key] = value;
      }
    }
    return convertedRow;
  });
}

export async function executeMsSqlQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {
  const config: sql.config = {
    server: params.credentials.server,
    port: params.credentials.port || 1433,
    database: params.credentials.database,
    user: params.credentials.user,
    password: params.credentials.password,
    options: {
      encrypt: params.credentials.options?.encrypt ?? false,
      trustServerCertificate:
        params.credentials.options?.trustServerCertificate ?? true,
      connectTimeout: params.credentials.options?.connectionTimeout ?? 15000,
      requestTimeout:
        params.security?.queryTimeoutMs ??
        params.credentials.options?.requestTimeout ??
        30000,
    },
  };

  let pool: sql.ConnectionPool | null = null;

  try {
    // Create connection pool
    pool = await sql.connect(config);

    // Create request
    const request = pool.request();

    // Extract all parameters referenced in the query
    const queryParams = extractQueryParameters(params.query);

    // Declare all query parameters, using NULL for missing values
    for (const paramName of queryParams) {
      const value = params.params?.[paramName] ?? null;

      // Infer SQL type from JavaScript type
      let sqlType: (() => sql.ISqlType) | sql.ISqlType = sql.NVarChar;
      if (value === null) {
        // For NULL values, use NVarChar as a flexible type
        sqlType = sql.NVarChar;
      } else if (typeof value === 'number') {
        sqlType = Number.isInteger(value) ? sql.Int : sql.Float;
      } else if (typeof value === 'boolean') {
        sqlType = sql.Bit;
      } else if (value instanceof Date) {
        sqlType = sql.DateTime;
      }

      request.input(paramName, sqlType, value);
    }

    // Execute query
    const result = await request.query(params.query);

    // Apply row limit if specified
    const maxRows = params.security?.maxResultRows ?? 10000;
    const rawData = result.recordset.slice(0, maxRows);

    // Convert Date objects to timestamps for Convex compatibility
    const data = convertDatesInData(rawData);

    return {
      success: true,
      data: toConvexJsonValue(data),
      rowCount: data.length,
    };
  } finally {
    // Close connection pool
    if (pool) {
      await pool.close();
    }
  }
}
