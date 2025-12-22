'use node';

/**
 * Execute MS SQL Server query
 */

import sql from 'mssql';
import type { SqlExecutionParams, SqlExecutionResult } from '../types';

export async function executeMsSqlQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {

  const config: any = {
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

  let pool: any = null;

  try {
    // Create connection pool
    pool = await sql.connect(config);

    // Create request
    const request = pool.request();

    // Add parameters if provided
    if (params.params) {
      for (const [key, value] of Object.entries(params.params)) {
        // Infer SQL type from JavaScript type
        let sqlType: any = sql.NVarChar;
        if (typeof value === 'number') {
          sqlType = Number.isInteger(value) ? sql.Int : sql.Float;
        } else if (typeof value === 'boolean') {
          sqlType = sql.Bit;
        } else if (value instanceof Date) {
          sqlType = sql.DateTime;
        }

        request.input(key, sqlType, value);
      }
    }

    // Execute query
    const result = await request.query(params.query);

    // Apply row limit if specified
    const maxRows = params.security?.maxResultRows ?? 10000;
    const data = result.recordset.slice(0, maxRows);

    return {
      success: true,
      data,
      rowCount: data.length,
    };
  } finally {
    // Close connection pool
    if (pool) {
      await pool.close();
    }
  }
}
