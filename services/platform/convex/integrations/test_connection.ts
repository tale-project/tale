/**
 * Test an integration connection
 *
 * Unified dispatch: REST integrations use connector testConnection via sandbox,
 * SQL integrations use SELECT 1 database ping.
 */

import type { Doc } from '../_generated/dataModel';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type {
  ApiKeyAuth,
  BasicAuth,
  ConnectionConfig,
  OAuth2Auth,
  SqlConnectionConfig,
  TestConnectionResult,
} from './types';

import { api, internal } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';
import { getPredefinedIntegration } from '../predefined_integrations';
import { buildTestSecrets } from './build_test_secrets';
import { isSqlIntegration } from './guards/is_sql_integration';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export interface TestConnectionArgs {
  integrationId: Id<'integrations'>;
  /** Inline API key auth for pre-save testing (plaintext, not yet encrypted) */
  apiKeyAuth?: ApiKeyAuth;
  /** Inline basic auth for pre-save testing (plaintext password, not yet encrypted) */
  basicAuth?: BasicAuth;
  /** Inline OAuth2 auth for pre-save testing (plaintext tokens, not yet encrypted) */
  oauth2Auth?: OAuth2Auth;
  /** Inline connection config for pre-save testing (not yet persisted) */
  connectionConfig?: ConnectionConfig;
  /** Inline SQL config for pre-save testing (not yet persisted) */
  sqlConnectionConfig?: SqlConnectionConfig;
}

function hasCredentials(integration: Doc<'integrations'>): boolean {
  return (
    !!integration.apiKeyAuth ||
    !!integration.basicAuth ||
    !!integration.oauth2Auth
  );
}

/**
 * Build secrets from inline plaintext credentials for pre-save testing.
 * Mirrors the pattern used by runHealthCheck in run_health_check.ts.
 */
function buildInlineSecrets(
  integration: Doc<'integrations'>,
  overrides: {
    apiKeyAuth?: ApiKeyAuth;
    basicAuth?: BasicAuth;
    oauth2Auth?: OAuth2Auth;
    connectionConfig?: ConnectionConfig;
  },
): Record<string, string> {
  const secrets: Record<string, string> = {};

  const domain =
    overrides.connectionConfig?.domain ?? integration.connectionConfig?.domain;
  if (domain) {
    secrets['domain'] = domain;
  }

  if (overrides.apiKeyAuth?.key) {
    secrets['accessToken'] = overrides.apiKeyAuth.key;
  }
  if (overrides.basicAuth) {
    if (overrides.basicAuth.username)
      secrets['username'] = overrides.basicAuth.username;
    if (overrides.basicAuth.password)
      secrets['password'] = overrides.basicAuth.password;
  }
  if (overrides.oauth2Auth?.accessToken) {
    secrets['accessToken'] = overrides.oauth2Auth.accessToken;
  }

  // Carry over non-auth connection config values (e.g. apiEndpoint)
  const connConfig = overrides.connectionConfig ?? integration.connectionConfig;
  if (connConfig) {
    for (const [key, value] of Object.entries(connConfig)) {
      if (key !== 'domain' && typeof value === 'string' && !(key in secrets)) {
        secrets[key] = value;
      }
    }
  }

  return secrets;
}

/**
 * Execute test connection via sandbox for REST integrations.
 * Supports inline credential overrides for pre-save (dry-run) testing.
 */
async function testRestConnection(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
  overrides?: {
    apiKeyAuth?: ApiKeyAuth;
    basicAuth?: BasicAuth;
    oauth2Auth?: OAuth2Auth;
    connectionConfig?: ConnectionConfig;
  },
): Promise<void> {
  // Find connector code: from integration or from predefined fallback
  let connectorCode = integration.connector?.code;
  let allowedHosts = integration.connector?.allowedHosts;
  let timeoutMs = integration.connector?.timeoutMs;

  if (!connectorCode) {
    const predefined = getPredefinedIntegration(integration.name);
    if (predefined?.connector) {
      connectorCode = predefined.connector.code;
      allowedHosts = predefined.connector.allowedHosts;
      timeoutMs = predefined.connector.timeoutMs;
    }
  }

  if (!connectorCode) {
    throw new Error(
      `Test connection not available for "${integration.name}". ` +
        'Integration has no connector code with a testConnection method.',
    );
  }

  const hasInlineOverrides = !!(
    overrides?.apiKeyAuth ||
    overrides?.basicAuth ||
    overrides?.oauth2Auth ||
    overrides?.connectionConfig
  );

  const secrets = hasInlineOverrides
    ? buildInlineSecrets(integration, overrides)
    : await buildTestSecrets(ctx, integration);

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
    throw new Error(result.error ?? 'Test connection failed');
  }
}

/**
 * Execute test connection via SELECT 1 for SQL integrations.
 * Supports inline overrides for pre-save testing (credentials not yet persisted).
 */
async function testSqlConnection(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
  overrides?: {
    sqlConnectionConfig?: TestConnectionArgs['sqlConnectionConfig'];
    basicAuth?: TestConnectionArgs['basicAuth'];
  },
): Promise<void> {
  const sqlConfig =
    overrides?.sqlConnectionConfig ?? integration.sqlConnectionConfig;

  if (!sqlConfig) {
    throw new Error('SQL integration is missing database configuration.');
  }

  const { engine, server, port, database, options } = sqlConfig;

  if (!server || !database) {
    throw new Error(
      'Please configure database server and database name first.',
    );
  }

  let user: string;
  let password: string;

  if (overrides?.basicAuth) {
    if (!overrides.basicAuth.username || !overrides.basicAuth.password) {
      throw new Error('Please provide both username and password.');
    }
    user = overrides.basicAuth.username;
    password = overrides.basicAuth.password;
  } else {
    if (!integration.basicAuth) {
      throw new Error('Please save database credentials first.');
    }
    user = integration.basicAuth.username;
    password = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: integration.basicAuth.passwordEncrypted },
    );
  }

  const result = await ctx.runAction(
    internal.node_only.sql.internal_actions.executeQuery,
    {
      engine,
      credentials: {
        server,
        port,
        database,
        user,
        password,
        options,
      },
      query: 'SELECT 1',
      params: {},
      security: { maxResultRows: 1, queryTimeoutMs: 10000 },
    },
  );

  if (!result.success) {
    throw new Error(result.error ?? 'SQL connection test failed');
  }
}

/**
 * Test an integration connection (REST via sandbox, SQL via ping)
 */
export async function testConnection(
  ctx: ActionCtx,
  args: TestConnectionArgs,
): Promise<TestConnectionResult> {
  const integration = await ctx.runQuery(api.integrations.queries.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    return {
      success: false,
      message: 'Integration not found',
    };
  }

  // Dry-run mode: inline overrides skip DB status mutations (credentials not yet persisted)
  const isDryRun = !!(
    args.sqlConnectionConfig ||
    args.basicAuth ||
    args.apiKeyAuth ||
    args.oauth2Auth ||
    args.connectionConfig
  );

  try {
    debugLog(`Test Connection Testing ${integration.name} integration...`);

    if (isSqlIntegration(integration)) {
      await testSqlConnection(ctx, integration, {
        sqlConnectionConfig: args.sqlConnectionConfig,
        basicAuth: args.basicAuth,
      });
    } else {
      const hasInlineOverrides = !!(
        args.apiKeyAuth ||
        args.basicAuth ||
        args.oauth2Auth ||
        args.connectionConfig
      );
      if (!hasInlineOverrides && !hasCredentials(integration)) {
        return {
          success: false,
          message:
            'Please save your credentials before testing the connection.',
        };
      }
      await testRestConnection(ctx, integration, {
        apiKeyAuth: args.apiKeyAuth,
        basicAuth: args.basicAuth,
        oauth2Auth: args.oauth2Auth,
        connectionConfig: args.connectionConfig,
      });
    }

    if (!isDryRun) {
      await ctx.runMutation(
        internal.integrations.internal_mutations.updateIntegration,
        {
          integrationId: args.integrationId,
          status: 'active',
          isActive: true,
          errorMessage: undefined,
        },
      );
    }

    debugLog(
      `Test Connection Successfully tested ${integration.name} integration`,
    );

    return {
      success: true,
      message: 'Connection successful',
    };
  } catch (error) {
    console.error(
      `[Test Connection] Failed to test ${integration.name} integration:`,
      error,
    );

    if (!isDryRun) {
      await ctx.runMutation(
        internal.integrations.internal_mutations.updateIntegration,
        {
          integrationId: args.integrationId,
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
        },
      );
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}
