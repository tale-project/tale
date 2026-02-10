'use node';

/**
 * Execute SQL query with validation and routing to appropriate engine
 */

import type { SqlExecutionParams, SqlExecutionResult } from '../types';

import { executeMsSqlQuery } from './execute_mssql_query';
import { executeMySqlQuery } from './execute_mysql_query';
import { executePostgresQuery } from './execute_postgres_query';
import { validateQuery } from './validate_query';

export async function executeQuery(
  params: SqlExecutionParams,
): Promise<SqlExecutionResult> {
  const startTime = Date.now();

  // Validate query for security (readOnly = !allowWrite)
  const readOnly = !params.allowWrite;
  validateQuery(params.query, readOnly);

  // Route to appropriate engine
  let result: SqlExecutionResult;

  switch (params.engine) {
    case 'mssql':
      result = await executeMsSqlQuery(params);
      break;

    case 'postgres':
      result = await executePostgresQuery(params);
      break;

    case 'mysql':
      result = await executeMySqlQuery(params);
      break;

    default:
      throw new Error(`Unsupported SQL engine: ${String(params.engine)}`);
  }

  return {
    ...result,
    duration: Date.now() - startTime,
  };
}
