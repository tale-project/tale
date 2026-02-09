/**
 * Business logic for creating an integration with encryption and health checks
 *
 * Supports both REST API and SQL integrations.
 * For SQL integrations, pass sqlConnectionConfig with the database connection details.
 */

import type {
  AuditLogActorType,
  AuditLogCategory,
  AuditLogStatus,
} from '../audit_logs/types';

import { api, internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { ActionCtx } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import { encryptCredentials } from './encrypt_credentials';
import { runHealthCheck } from './run_health_check';
import { saveRelatedWorkflows } from './save_related_workflows';
import {
  AuthMethod,
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  ConnectionConfig,
  Capabilities,
  SqlConnectionConfig,
  SqlOperation,
} from './types';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export interface CreateIntegrationLogicArgs {
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
  // SQL integration fields
  type?: 'rest_api' | 'sql';
  sqlConnectionConfig?: SqlConnectionConfig;
  sqlOperations?: SqlOperation[];
  metadata?: unknown;
}

/**
 * Main logic for creating an integration
 */
export async function createIntegrationLogic(
  ctx: ActionCtx,
  args: CreateIntegrationLogicArgs,
): Promise<Id<'integrations'>> {
  // Verify access (RLS check)
  // @ts-ignore TS2589: Convex API type instantiation is excessively deep
  await ctx.runQuery(api.integrations.queries.list, {
    organizationId: args.organizationId,
  });

  // Validate SQL connection config for SQL integrations
  if (args.type === 'sql') {
    if (!args.sqlConnectionConfig) {
      throw new Error('SQL integration requires sqlConnectionConfig');
    }
    if (
      !args.sqlConnectionConfig.server ||
      args.sqlConnectionConfig.server.trim() === ''
    ) {
      throw new Error('SQL integration requires a server address');
    }
    if (
      !args.sqlConnectionConfig.database ||
      args.sqlConnectionConfig.database.trim() === ''
    ) {
      throw new Error('SQL integration requires a database name');
    }
    if (!args.sqlConnectionConfig.engine) {
      throw new Error(
        'SQL integration requires an engine type (mssql, postgres, or mysql)',
      );
    }
  }

  // Encrypt credentials
  const { apiKeyAuth, basicAuth, oauth2Auth } = await encryptCredentials(args);

  // Run health check (skip for SQL integrations - connection test happens at create time)
  if (args.type !== 'sql') {
    await runHealthCheck(args);
  }

  // Create integration - type assertions needed due to schema mismatches between shared types and mutation
  // The generated API types need regeneration (run `npx convex dev`)
  const integrationId: Id<'integrations'> = await (ctx.runMutation as any)(
    internal.integrations.internal_mutations.createIntegration,
    {
      organizationId: args.organizationId,
      name: args.name,
      title: args.title,
      description: args.description,
      // Set to 'active' since health check passed (or SQL integration)
      status: 'active',
      isActive: true,
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
      // SQL integration fields
      type: args.type,
      sqlConnectionConfig: args.sqlConnectionConfig as
        | Record<string, unknown>
        | undefined,
      sqlOperations: args.sqlOperations as
        | Record<string, unknown>[]
        | undefined,
      metadata: args.metadata,
    },
  );

  debugLog(
    `Integration Create Successfully created ${args.name} integration with ID: ${integrationId}`,
  );

  // Save related workflows for this integration
  const workflowIds = await saveRelatedWorkflows(ctx, {
    organizationId: args.organizationId,
    name: args.name,
    connectionConfig: args.connectionConfig,
  });

  debugLog(`Integration Create Saved ${workflowIds.length} related workflows`);

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
