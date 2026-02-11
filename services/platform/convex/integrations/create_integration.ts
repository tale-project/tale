/**
 * Create an integration with encryption and health checks
 *
 * Supports both REST API and SQL integrations.
 * For SQL integrations, pass sqlConnectionConfig with the database connection details.
 */

import type { ActionCtx } from '../_generated/server';
import type {
  AuditLogActorType,
  AuditLogCategory,
  AuditLogStatus,
} from '../audit_logs/types';

import { api, internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { createDebugLog } from '../lib/debug_log';
import { encryptCredentials } from './encrypt_credentials';
import { runHealthCheck } from './run_health_check';
import {
  AuthMethod,
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  ConnectionConfig,
  Capabilities,
  ConnectorConfig,
  SqlConnectionConfig,
  SqlOperation,
} from './types';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export interface CreateIntegrationArgs {
  organizationId: string;
  name: string;
  title: string;
  description?: string;
  authMethod: AuthMethod;
  apiKeyAuth?: ApiKeyAuth;
  basicAuth?: BasicAuth;
  oauth2Auth?: OAuth2Auth;
  connectionConfig?: ConnectionConfig;
  capabilities?: Capabilities;
  connector?: ConnectorConfig;
  // SQL integration fields
  type?: 'rest_api' | 'sql';
  sqlConnectionConfig?: SqlConnectionConfig;
  sqlOperations?: SqlOperation[];
  iconStorageId?: Id<'_storage'>;
  metadata?: unknown;
}

/**
 * Create an integration, encrypt credentials, and run initial health check
 */
export async function createIntegration(
  ctx: ActionCtx,
  args: CreateIntegrationArgs,
): Promise<Id<'integrations'>> {
  // Verify access (RLS check)
  await ctx.runQuery(api.integrations.queries.list, {
    organizationId: args.organizationId,
  });

  // Validate SQL connection config for SQL integrations
  if (args.type === 'sql') {
    if (!args.sqlConnectionConfig) {
      throw new Error('SQL integration requires sqlConnectionConfig');
    }
    if (!args.sqlConnectionConfig.engine) {
      throw new Error(
        'SQL integration requires an engine type (mssql, postgres, or mysql)',
      );
    }
  }

  // Encrypt credentials
  const { apiKeyAuth, basicAuth, oauth2Auth } = await encryptCredentials(args);

  const hasCredentials =
    !!args.apiKeyAuth || !!args.basicAuth || !!args.oauth2Auth;

  // Run health check (skip for integrations without credentials)
  if (hasCredentials) {
    await runHealthCheck(ctx, args);
  }

  // Create integration - type assertions needed due to schema mismatches between shared types and mutation
  // The generated API types need regeneration (run `npx convex dev`)
  const integrationId: Id<'integrations'> =
    await // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex context type
    (ctx.runMutation as (...args: unknown[]) => Promise<Id<'integrations'>>)(
      internal.integrations.internal_mutations.createIntegration,
      {
        organizationId: args.organizationId,
        name: args.name,
        title: args.title,
        description: args.description,
        status: hasCredentials ? 'active' : 'inactive',
        isActive: hasCredentials,
        authMethod:
          args.authMethod === 'bearer_token' ? 'api_key' : args.authMethod,
        apiKeyAuth,
        basicAuth: basicAuth
          ? {
              username: basicAuth.username ?? '',
              passwordEncrypted: basicAuth.passwordEncrypted,
            }
          : undefined,
        oauth2Auth,
        connectionConfig: args.connectionConfig as
          | Record<string, unknown>
          | undefined,
        capabilities: args.capabilities,
        connector: args.connector,
        // SQL integration fields
        type: args.type,
        sqlConnectionConfig: args.sqlConnectionConfig as
          | Record<string, unknown>
          | undefined,
        sqlOperations: args.sqlOperations as
          | Record<string, unknown>[]
          | undefined,
        iconStorageId: args.iconStorageId,
        metadata: args.metadata,
      },
    );

  debugLog(
    `Integration Create Successfully created ${args.name} integration with ID: ${integrationId}`,
  );

  try {
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: args.organizationId,
        actorId: 'system',
        actorType: 'system' as AuditLogActorType,
        action: 'create_integration',
        category: 'integration' as AuditLogCategory,
        resourceType: 'integration',
        resourceId: String(integrationId),
        resourceName: args.name,
        newState: {
          name: args.name,
          title: args.title,
          type: args.type ?? 'rest_api',
          authMethod: args.authMethod,
        },
        status: 'success' as AuditLogStatus,
      },
    );
  } catch (error) {
    debugLog(
      `Failed to create audit log for integration ${integrationId}:`,
      error,
    );
  }

  return integrationId;
}
