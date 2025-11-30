/**
 * Business logic for creating an integration with encryption and health checks
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
} from './types';
import { saveRelatedWorkflows } from './save_related_workflows';
import { encryptCredentials } from './encrypt_credentials';
import { runHealthCheck } from './run_health_check';

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

  // Run health check
  await runHealthCheck(args);

  // Create integration
  const integrationId: Id<'integrations'> = await ctx.runMutation(
    internal.integrations.createIntegrationInternal,
    {
      organizationId: args.organizationId,
      name: args.name,
      title: args.title,
      description: args.description,
      // Set to 'active' since health check passed
      status: 'active',
      isActive: true,
      authMethod: args.authMethod,
      apiKeyAuth,
      basicAuth,
      oauth2Auth,
      connectionConfig: args.connectionConfig,
      capabilities: args.capabilities,
      metadata: args.metadata,
    },
  );

  console.log(
    `[Integration Create] Successfully created ${args.name} integration with ID: ${integrationId}`,
  );

  // Save related workflows for this integration
  const workflowIds = await saveRelatedWorkflows(ctx, {
    organizationId: args.organizationId,
    name: args.name,
    connectionConfig: args.connectionConfig,
  });

  console.log(
    `[Integration Create] Saved ${workflowIds.length} related workflows`,
  );

  return integrationId;
}
