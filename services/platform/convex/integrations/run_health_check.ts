/**
 * Health check for integration creation and credential updates.
 * Uses sandbox testConnection for REST, SELECT 1 for SQL.
 */

import type { ActionCtx } from '../_generated/server';
import type { ConnectorConfig, SqlConnectionConfig } from './types';

import { internal } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';
import { getPredefinedIntegration } from '../predefined_integrations';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

interface HealthCheckArgs {
  name: string;
  type?: 'rest_api' | 'sql';
  connector?: ConnectorConfig;
  connectionConfig?: { domain?: string };
  apiKeyAuth?: { key: string };
  basicAuth?: { username: string; password: string };
  oauth2Auth?: { accessToken: string };
  sqlConnectionConfig?: SqlConnectionConfig;
}

export async function runHealthCheck(
  ctx: ActionCtx,
  args: HealthCheckArgs,
): Promise<void> {
  debugLog(`Integration Create Running health check for ${args.name}...`);

  if (args.type === 'sql') {
    await runSqlHealthCheck(ctx, args);
    return;
  }

  await runRestHealthCheck(ctx, args);
}

async function runSqlHealthCheck(
  ctx: ActionCtx,
  args: HealthCheckArgs,
): Promise<void> {
  let sqlConfig = args.sqlConnectionConfig;

  if (!sqlConfig) {
    const predefined = getPredefinedIntegration(args.name);
    if (predefined?.type === 'sql' && predefined.sqlConnectionConfig) {
      sqlConfig = predefined.sqlConnectionConfig;
    }
  }

  if (!sqlConfig?.server || !sqlConfig.database) {
    debugLog(
      `Skipping SQL health check for ${args.name}: missing server or database config`,
    );
    return;
  }

  if (!args.basicAuth?.username || !args.basicAuth.password) {
    debugLog(
      `Skipping SQL health check for ${args.name}: missing database credentials`,
    );
    return;
  }

  const result = await ctx.runAction(
    internal.node_only.sql.internal_actions.executeQuery,
    {
      engine: sqlConfig.engine,
      credentials: {
        server: sqlConfig.server,
        port: sqlConfig.port,
        database: sqlConfig.database,
        user: args.basicAuth.username,
        password: args.basicAuth.password,
        options: sqlConfig.options,
      },
      query: 'SELECT 1',
      params: {},
      security: { maxResultRows: 1, queryTimeoutMs: 10000 },
    },
  );

  if (!result.success) {
    throw new Error(result.error ?? 'SQL health check failed');
  }

  debugLog(`Integration Create Health check passed for ${args.name}`);
}

async function runRestHealthCheck(
  ctx: ActionCtx,
  args: HealthCheckArgs,
): Promise<void> {
  // Build secrets from plaintext credentials
  const secrets: Record<string, string> = {};
  if (args.connectionConfig?.domain) {
    secrets['domain'] = args.connectionConfig.domain;
  }
  if (args.apiKeyAuth?.key) {
    secrets['accessToken'] = args.apiKeyAuth.key;
  }
  if (args.basicAuth) {
    if (args.basicAuth.username) secrets['username'] = args.basicAuth.username;
    if (args.basicAuth.password) secrets['password'] = args.basicAuth.password;
  }
  if (args.oauth2Auth?.accessToken) {
    secrets['accessToken'] = args.oauth2Auth.accessToken;
  }

  // Find connector code
  let connectorCode = args.connector?.code;
  let allowedHosts = args.connector?.allowedHosts;
  let timeoutMs = args.connector?.timeoutMs;

  if (!connectorCode) {
    const predefined = getPredefinedIntegration(args.name);
    if (predefined?.connector) {
      connectorCode = predefined.connector.code;
      allowedHosts = predefined.connector.allowedHosts;
      timeoutMs = predefined.connector.timeoutMs;
    }
  }

  if (!connectorCode) {
    throw new Error(
      `Health check failed for "${args.name}": missing connector code. ` +
        'REST integrations require connector code with a testConnection method.',
    );
  }

  const result = await ctx.runAction(
    internal.node_only.integration_sandbox.internal_actions.executeIntegration,
    {
      code: connectorCode,
      operation: '__test_connection__',
      params: {},
      variables: {},
      secrets,
      allowedHosts,
      timeoutMs: timeoutMs ?? 15000,
    },
  );

  if (!result.success) {
    throw new Error(result.error ?? 'Health check failed');
  }

  debugLog(`Integration Create Health check passed for ${args.name}`);
}
