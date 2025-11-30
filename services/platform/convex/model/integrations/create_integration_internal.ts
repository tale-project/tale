/**
 * Internal mutation to create integration
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import {
  AuthMethod,
  Status,
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
  ConnectionConfig,
  Capabilities,
  ConnectorConfig,
} from './types';
import { getPredefinedIntegration } from '../../predefined_integrations';

export interface CreateIntegrationInternalArgs {
  organizationId: string;
  name: string;
  title: string;
  description?: string;
  status: Status;
  isActive: boolean;
  authMethod: AuthMethod;
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
  connectionConfig?: ConnectionConfig;
  capabilities?: Capabilities;
  connector?: ConnectorConfig;
  metadata?: unknown;
}

export async function createIntegrationInternal(
  ctx: MutationCtx,
  args: CreateIntegrationInternalArgs,
): Promise<Id<'integrations'>> {
  // Get connector config from args or predefined integration
  let connector = args.connector;
  let title = args.title;
  let description = args.description;

  // For predefined integrations, auto-populate connector and metadata
  const predefined = getPredefinedIntegration(args.name);
  if (!connector && predefined) {
    connector = predefined.connector;
    title = title ?? predefined.title;
    description = description ?? predefined.description;
  }

  const integrationId = await ctx.db.insert('integrations', {
    organizationId: args.organizationId,
    name: args.name,
    title,
    description,
    status: args.status,
    isActive: args.isActive,
    authMethod: args.authMethod,
    apiKeyAuth: args.apiKeyAuth,
    basicAuth: args.basicAuth,
    oauth2Auth: args.oauth2Auth,
    connectionConfig: args.connectionConfig,
    capabilities: args.capabilities,
    connector,
    lastTestedAt: Date.now(),
    metadata: args.metadata,
  });

  return integrationId;
}
