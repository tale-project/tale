/**
 * Business logic for updating an integration with encryption and health checks
 */

import { ActionCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import {
  Status,
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  ConnectionConfig,
  Capabilities,
} from './types';
import { encryptCredentials } from './encrypt_credentials';
import { testShopifyConnection } from './test_shopify_connection';
import { testCirculyConnection } from './test_circuly_connection';

import { createDebugLog } from '../lib/debug_log';
import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

export interface UpdateIntegrationLogicArgs {
  integrationId: Id<'integrations'>;
  status?: Status;
  isActive?: boolean;
  apiKeyAuth?: ApiKeyAuth;
  basicAuth?: BasicAuth;
  oauth2Auth?: OAuth2Auth;
  connectionConfig?: ConnectionConfig;
  capabilities?: Capabilities;
  errorMessage?: string;
  metadata?: ConvexJsonRecord;
}

/**
 * Run health check if credentials are being updated
 */
async function runHealthCheckIfNeeded(
  integration: Doc<'integrations'>,
  args: UpdateIntegrationLogicArgs,
): Promise<void> {
  const credentialsChanged = !!(
    args.apiKeyAuth ||
    args.basicAuth ||
    args.oauth2Auth
  );

  if (!credentialsChanged) {
    return;
  }

  debugLog(
    `Integration Update Running health check for ${integration.name}...`,
  );

  try {
    if (integration.name === 'shopify') {
      const domain =
        args.connectionConfig?.domain || integration.connectionConfig?.domain;
      const accessToken = args.apiKeyAuth?.key;

      if (!domain || !accessToken) {
        throw new Error('Shopify integration requires domain and access token');
      }
      await testShopifyConnection(domain, accessToken);
    } else if (integration.name === 'circuly') {
      const username = args.basicAuth?.username;
      const password = args.basicAuth?.password;

      if (!username || !password) {
        throw new Error('Circuly integration requires username and password');
      }
      await testCirculyConnection(username, password);
    }

    debugLog(`Integration Update Health check passed for ${integration.name}`);
  } catch (error) {
    console.error(
      `[Integration Update] Health check failed for ${integration.name}:`,
      error,
    );
    throw error; // Propagate the error to prevent integration update
  }
}

/**
 * Main logic for updating an integration
 */
export async function updateIntegrationLogic(
  ctx: ActionCtx,
  args: UpdateIntegrationLogicArgs,
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
  await runHealthCheckIfNeeded(integration, args);

  // Update integration
  await ctx.runMutation(internal.integrations.internal_mutations.updateIntegration, {
    integrationId: args.integrationId,
    status: args.status,
    isActive: args.isActive,
    apiKeyAuth,
    basicAuth,
    oauth2Auth,
    connectionConfig: args.connectionConfig,
    capabilities: args.capabilities,
    errorMessage: args.errorMessage,
    metadata: args.metadata,
  });
}
