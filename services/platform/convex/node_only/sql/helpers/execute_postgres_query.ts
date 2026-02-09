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
      // Extract unique parameter names and build a mapping to positional indices
      const paramPattern = /\$(\w+)|:(\w+)/g;
      const paramToIndex = new Map<string, number>();
      let index = 1;

      // First pass: assign positional index to each unique parameter name
      const matches = [...params.query.matchAll(paramPattern)];
      for (const match of matches) {
        const name = match[1] || match[2];
        if (!paramToIndex.has(name)) {
          paramToIndex.set(name, index++);
          values.push(params.params![name]);
        }
      }

      // Second pass: replace named parameters with their positional indices
      processedQuery = params.query.replace(paramPattern, (_, p1, p2) => {
        const name = p1 || p2;
        return `$${paramToIndex.get(name)}`;
      });
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
