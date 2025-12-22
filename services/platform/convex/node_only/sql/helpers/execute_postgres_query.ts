'use node';

/**
 * Execute PostgreSQL query
 */

import { Pool } from 'pg';
import type { SqlExecutionParams, SqlExecutionResult } from '../types';

export async function executePostgresQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {
  const pool = new Pool({
    host: params.credentials.server,
    port: params.credentials.port || 5432,
    database: params.credentials.database,
    user: params.credentials.user,
    password: params.credentials.password,
    max: 5,
    connectionTimeoutMillis:
      params.credentials.options?.connectionTimeout ?? 15000,
    statement_timeout: params.security?.queryTimeoutMs ?? 30000,
  });

  try {
    // Convert named parameters to positional ($1, $2, etc.)
    let processedQuery = params.query;
    const values: unknown[] = [];

    if (params.params) {
      // Extract parameter names from query (looking for $paramName or :paramName patterns)
      const paramPattern = /\$(\w+)|:(\w+)/g;
      const matches = [...params.query.matchAll(paramPattern)];
      const paramNames = matches.map((m) => m[1] || m[2]);

      // Replace with positional parameters
      let index = 1;
      processedQuery = params.query.replace(paramPattern, () => `$${index++}`);

      // Build values array in order
      for (const name of paramNames) {
        values.push(params.params![name]);
      }
    }

    // Execute query
    const result = await pool.query(processedQuery, values);

    // Apply row limit if specified
    const maxRows = params.security?.maxResultRows ?? 10000;
    const data = result.rows.slice(0, maxRows);

    return {
      success: true,
      data,
      rowCount: data.length,
    };
  } finally {
    // Close pool
    await pool.end();
  }
}
