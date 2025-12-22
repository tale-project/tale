'use node';

/**
 * Execute MySQL query
 */

import mysql from 'mysql2/promise';
import type { SqlExecutionParams, SqlExecutionResult } from '../types';

export async function executeMySqlQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {

  const pool = mysql.createPool({
    host: params.credentials.server,
    port: params.credentials.port || 3306,
    database: params.credentials.database,
    user: params.credentials.user,
    password: params.credentials.password,
    connectionLimit: 5,
    connectTimeout: params.credentials.options?.connectionTimeout ?? 15000,
  });

  try {
    // Convert named parameters to positional (?)
    let processedQuery = params.query;
    const values: unknown[] = [];

    if (params.params) {
      // Extract parameter names from query
      const paramPattern = /\?(\w+)|:(\w+)/g;
      const matches = [...params.query.matchAll(paramPattern)];
      const paramNames = matches.map((m) => m[1] || m[2]);

      // Replace with ? placeholders
      processedQuery = params.query.replace(paramPattern, '?');

      // Build values array in order
      for (const name of paramNames) {
        values.push(params.params![name]);
      }
    }

    // Execute query
    const [rows] = await pool.query(processedQuery, values);

    // Apply row limit if specified
    const maxRows = params.security?.maxResultRows ?? 10000;
    const data = Array.isArray(rows) ? rows.slice(0, maxRows) : [];

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
