/**
 * Business logic for creating an integration with encryption and health checks
 *
 * Supports both REST API and SQL integrations.
 * For SQL integrations, pass sqlConnectionConfig with the database connection details.
 */

import { ActionCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { api, internal } from '../../_generated/api';
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
import { saveRelatedWorkflows } from './save_related_workflows';
import { encryptCredentials } from './encrypt_credentials';
import { runHealthCheck } from './run_health_check';

import { createDebugLog } from '../../lib/debug_log';

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
  await ctx.runQuery(api.integrations.list, {
    organizationId: args.organizationId,
  });

  // Encrypt credentials
  const { apiKeyAuth, basicAuth, oauth2Auth } = await encryptCredentials(
    ctx,
    args,
  );

  // Run health check (skip for SQL integrations - connection test happens at create time)
  if (args.type !== 'sql') {
    await runHealthCheck(args);
  }

  // Create integration
  const integrationId: Id<'integrations'> = await ctx.runMutation(
    internal.integrations.createIntegrationInternal,
    {
      organizationId: args.organizationId,
      name: args.name,
      title: args.title,
      description: args.description,
      // Set to 'active' since health check passed (or SQL integration)
      status: 'active',
      isActive: true,
      authMethod: args.authMethod,
      apiKeyAuth,
      basicAuth,
      oauth2Auth,
      connectionConfig: args.connectionConfig,
      capabilities: args.capabilities,
      // SQL integration fields
      type: args.type,
      sqlConnectionConfig: args.sqlConnectionConfig,
      sqlOperations: args.sqlOperations,
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

  return integrationId;
}
