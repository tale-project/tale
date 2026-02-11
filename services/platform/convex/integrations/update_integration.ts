/**
 * Update an integration with encryption and health checks
 */

import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';

import { api, internal } from '../_generated/api';
import { Doc, Id } from '../_generated/dataModel';
import { ActionCtx } from '../_generated/server';
import { encryptCredentials } from './encrypt_credentials';
import { runHealthCheck } from './run_health_check';
import {
  AuthMethod,
  Status,
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  ConnectionConfig,
  SqlConnectionConfig,
  Capabilities,
} from './types';

export interface UpdateIntegrationArgs {
  integrationId: Id<'integrations'>;
  authMethod?: AuthMethod;
  status?: Status;
  isActive?: boolean;
  apiKeyAuth?: ApiKeyAuth;
  basicAuth?: BasicAuth;
  oauth2Auth?: OAuth2Auth;
  connectionConfig?: ConnectionConfig;
  sqlConnectionConfig?: SqlConnectionConfig;
  capabilities?: Capabilities;
  errorMessage?: string;
  metadata?: ConvexJsonRecord;
}

/**
 * Run health check if credentials are being updated
 */
async function runHealthCheckIfNeeded(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
  args: UpdateIntegrationArgs,
): Promise<void> {
  const credentialsChanged = !!(
    args.apiKeyAuth ||
    args.basicAuth ||
    args.oauth2Auth
  );

  if (!credentialsChanged) {
    return;
  }

  const domain =
    args.connectionConfig?.domain ?? integration.connectionConfig?.domain;

  await runHealthCheck(ctx, {
    name: integration.name,
    type: integration.type ?? undefined,
    connector: integration.connector ?? undefined,
    connectionConfig: domain ? { domain } : undefined,
    apiKeyAuth: args.apiKeyAuth,
    basicAuth: args.basicAuth,
    oauth2Auth: args.oauth2Auth,
  });
}

/**
 * Update an integration, encrypt credentials, and re-check health
 */
export async function updateIntegration(
  ctx: ActionCtx,
  args: UpdateIntegrationArgs,
): Promise<void> {
  // Get integration (with RLS check)
  const integration = await ctx.runQuery(api.integrations.queries.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  // Encrypt credentials
  const { apiKeyAuth, basicAuth, oauth2Auth } = await encryptCredentials(args);

  // Run health check if credentials changed
  await runHealthCheckIfNeeded(ctx, integration, args);

  // Update integration
  await ctx.runMutation(
    internal.integrations.internal_mutations.updateIntegration,
    {
      integrationId: args.integrationId,
      authMethod: args.authMethod,
      status: args.status,
      isActive: args.isActive,
      apiKeyAuth,
      basicAuth,
      oauth2Auth,
      connectionConfig: args.connectionConfig,
      sqlConnectionConfig: args.sqlConnectionConfig,
      capabilities: args.capabilities,
      errorMessage: args.errorMessage,
      metadata: args.metadata,
    },
  );
}
