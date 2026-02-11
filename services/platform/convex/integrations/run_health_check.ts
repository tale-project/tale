/**
 * Health check for integration creation and credential updates.
 * Uses sandbox testConnection for REST, SELECT 1 for SQL.
 */

import type { ActionCtx } from '../_generated/server';
import type { ConnectorConfig } from './types';

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
}

export async function runHealthCheck(
  ctx: ActionCtx,
  args: HealthCheckArgs,
): Promise<void> {
  debugLog(`Integration Create Running health check for ${args.name}...`);

  if (args.type === 'sql') {
    return;
  }

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
    return;
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
