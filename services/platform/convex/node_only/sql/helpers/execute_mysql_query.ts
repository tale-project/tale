'use node';

/**
 * Execute MySQL query
 */

import mysql from 'mysql2/promise';
import type { SqlExecutionParams, SqlExecutionResult } from '../types';

export async function executeMySqlQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {

  // Apply row limit via SQL LIMIT clause for efficiency
  const maxRows = params.security?.maxResultRows ?? 10000;
  const queryTimeoutMs = params.security?.queryTimeoutMs ?? 30000;

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

    // Get a connection to set session timeout
    const connection = await pool.getConnection();
    try {
      // Set query timeout at session level (in milliseconds for MySQL 8.0.28+)
      await connection.query(`SET SESSION MAX_EXECUTION_TIME = ${queryTimeoutMs}`);

      // Execute query with timeout
      const [rows] = await connection.query(processedQuery, values);

      // Apply row limit (data is already limited by the database if query includes LIMIT)
      const data = Array.isArray(rows) ? rows.slice(0, maxRows) : [];

      return {
        success: true,
        data,
        rowCount: data.length,
      };
    } finally {
      connection.release();
    }
  } finally {
    // Close pool
    await pool.end();
  }
}
