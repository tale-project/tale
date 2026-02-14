/**
 * Internal mutation to create integration
 *
 * Supports both REST API and SQL integrations.
 */

import type { ConvexJsonValue } from '../../lib/shared/schemas/utils/json-value';
import type { MutationCtx } from '../_generated/server';

import { Id } from '../_generated/dataModel';
import {
  AuthMethod,
  Status,
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
  ConnectionConfig,
  Capabilities,
  ConnectorConfig,
  SqlConnectionConfig,
  SqlOperation,
} from './types';

export interface CreateIntegrationInternalArgs {
  organizationId: string;
  name: string;
  title: string;
  description?: string;
  status: Status;
  isActive: boolean;
  authMethod: AuthMethod;
  supportedAuthMethods?: AuthMethod[];
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
  connectionConfig?: ConnectionConfig;
  capabilities?: Capabilities;
  connector?: ConnectorConfig;
  // SQL integration fields
  type?: 'rest_api' | 'sql';
  sqlConnectionConfig?: SqlConnectionConfig;
  sqlOperations?: SqlOperation[];
  oauth2Config?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes?: string[];
    clientId?: string;
    clientSecretEncrypted?: string;
  };
  iconStorageId?: Id<'_storage'>;
  metadata?: ConvexJsonValue;
}

export async function createIntegrationInternal(
  ctx: MutationCtx,
  args: CreateIntegrationInternalArgs,
): Promise<Id<'integrations'>> {
  const connector = args.connector;
  const title = args.title;
  const description = args.description;
  const type = args.type;
  const sqlConnectionConfig = args.sqlConnectionConfig;
  const sqlOperations = args.sqlOperations;

  // Enforce unique name per organization
  const existing = await ctx.db
    .query('integrations')
    .withIndex('by_organizationId_and_name', (q) =>
      q.eq('organizationId', args.organizationId).eq('name', args.name),
    )
    .first();

  if (existing) {
    throw new Error(
      `Integration "${args.name}" already exists in this organization`,
    );
  }

  const integrationId = await ctx.db.insert('integrations', {
    organizationId: args.organizationId,
    name: args.name,
    title,
    description,
    type,
    status: args.status,
    isActive: args.isActive,
    authMethod: args.authMethod,
    supportedAuthMethods: args.supportedAuthMethods,
    apiKeyAuth: args.apiKeyAuth,
    basicAuth: args.basicAuth,
    oauth2Auth: args.oauth2Auth,
    connectionConfig: args.connectionConfig,
    capabilities: args.capabilities,
    connector,
    sqlConnectionConfig,
    sqlOperations,
    oauth2Config: args.oauth2Config,
    lastTestedAt: Date.now(),
    iconStorageId: args.iconStorageId,
    metadata: args.metadata,
  });

  return integrationId;
}
