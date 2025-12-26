/**
 * Type definitions for SQL execution
 */

import type { SqlEngine } from '../../model/integrations/types';

export interface SqlCredentials {
  server: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    connectionTimeout?: number;
    requestTimeout?: number;
  };
}

export interface SqlExecutionParams {
  engine: SqlEngine;
  credentials: SqlCredentials;
  query: string;
  params?: Record<string, unknown>;
  security?: {
    maxResultRows?: number;
    queryTimeoutMs?: number;
  };
  /** Allow write operations (UPDATE, INSERT, DELETE). Default: false (read-only) */
  allowWrite?: boolean;
}

export interface SqlExecutionResult {
  success: boolean;
  data?: unknown[];
  rowCount?: number;
  error?: string;
  duration?: number;
}
