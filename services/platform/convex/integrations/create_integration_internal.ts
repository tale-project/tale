/**
 * Internal mutation to create integration
 *
 * Supports both REST API and SQL integrations.
 * For predefined integrations (like Protel), automatically populates
 * connector code (REST API) or SQL operations from the predefined definitions.
 */

import type { ConvexJsonValue } from '../../lib/shared/schemas/utils/json-value';

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';
import { getPredefinedIntegration } from '../predefined_integrations';
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
  metadata?: ConvexJsonValue;
}

export async function createIntegrationInternal(
  ctx: MutationCtx,
  args: CreateIntegrationInternalArgs,
): Promise<Id<'integrations'>> {
  // Get connector config from args or predefined integration
  let connector = args.connector;
  let title = args.title;
  let description = args.description;
  let type = args.type;
  let sqlConnectionConfig = args.sqlConnectionConfig;
  let sqlOperations = args.sqlOperations;

  // For predefined integrations, auto-populate from predefined definitions
  const predefined = getPredefinedIntegration(args.name);
  if (predefined) {
    title = title ?? predefined.title;
    description = description ?? predefined.description;

    // Check if this is a SQL integration
    if (predefined.type === 'sql') {
      type = 'sql';

      // Validate required SQL connection fields
      if (sqlConnectionConfig) {
        if (
          !sqlConnectionConfig.server ||
          sqlConnectionConfig.server.trim() === ''
        ) {
          throw new Error('SQL integration requires a server address');
        }
        if (
          !sqlConnectionConfig.database ||
          sqlConnectionConfig.database.trim() === ''
        ) {
          throw new Error('SQL integration requires a database name');
        }
      }

      // Merge SQL connection config: user-provided values override predefined defaults
      // User MUST provide server and database at setup time
      if (predefined.sqlConnectionConfig && sqlConnectionConfig) {
        sqlConnectionConfig = {
          ...predefined.sqlConnectionConfig,
          ...sqlConnectionConfig,
          // Ensure required fields from user config take precedence
          server: sqlConnectionConfig.server,
          database: sqlConnectionConfig.database,
        };
      }

      // Use predefined SQL operations if not provided
      if (!sqlOperations && predefined.sqlOperations) {
        sqlOperations = predefined.sqlOperations as SqlOperation[];
      }
    } else {
      // REST API integration - use predefined connector
      if (!connector && predefined.connector) {
        connector = predefined.connector;
      }
    }
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
    apiKeyAuth: args.apiKeyAuth,
    basicAuth: args.basicAuth,
    oauth2Auth: args.oauth2Auth,
    connectionConfig: args.connectionConfig,
    capabilities: args.capabilities,
    connector,
    sqlConnectionConfig,
    sqlOperations,
    lastTestedAt: Date.now(),

    metadata: args.metadata as any,
  });

  return integrationId;
}
