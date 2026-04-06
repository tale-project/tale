'use node';

/**
 * Unified integration loader.
 *
 * Loads integration data from two sources:
 * 1. File system (INTEGRATIONS_DIR): config.json + connector.ts
 * 2. Database (integrationCredentials table): encrypted credentials, status, health
 *
 * Merges them into a `LoadedIntegration` object that matches the shape consumers
 * expect (compatible with the old `Doc<'integrations'>` structure).
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export interface LoadedIntegration {
  _id: Doc<'integrationCredentials'>['_id'];
  _creationTime: number;
  organizationId: string;
  name: string;
  title: string;
  description?: string;
  type?: 'rest_api' | 'sql';
  status: 'active' | 'inactive' | 'error' | 'testing';
  isActive: boolean;
  authMethod: 'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2';
  supportedAuthMethods?: Array<
    'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2'
  >;
  apiKeyAuth?: { keyEncrypted: string; keyPrefix?: string };
  basicAuth?: { username: string; passwordEncrypted: string };
  oauth2Auth?: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string;
    tokenExpiry?: number;
    scopes?: string[];
  };
  oauth2Config?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes?: string[];
    clientId?: string;
    clientSecretEncrypted?: string;
  };
  connectionConfig?: {
    domain?: string;
    apiVersion?: string;
    apiEndpoint?: string;
    timeout?: number;
    rateLimit?: number;
  };
  connector?: {
    code: string;
    version: number;
    operations: Array<{
      name: string;
      title?: string;
      description?: string;
      parametersSchema?: Record<string, unknown>;
      operationType?: 'read' | 'write';
      requiresApproval?: boolean;
      requiredScopes?: string[];
    }>;
    secretBindings: string[];
    allowedHosts?: string[];
    timeoutMs?: number;
  };
  sqlConnectionConfig?: {
    engine: 'mssql' | 'postgres' | 'mysql';
    server?: string;
    port?: number;
    database?: string;
    readOnly?: boolean;
    options?: {
      encrypt?: boolean;
      trustServerCertificate?: boolean;
      connectionTimeout?: number;
      requestTimeout?: number;
    };
    security?: {
      maxResultRows?: number;
      queryTimeoutMs?: number;
      maxConnectionPoolSize?: number;
    };
  };
  sqlOperations?: Array<{
    name: string;
    title?: string;
    description?: string;
    query: string;
    parametersSchema?: Record<string, unknown>;
    operationType?: 'read' | 'write';
    requiresApproval?: boolean;
  }>;
  capabilities?: {
    canSync?: boolean;
    canPush?: boolean;
    canWebhook?: boolean;
    syncFrequency?: string;
  };
  lastSyncedAt?: number;
  lastTestedAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  errorMessage?: string;
  syncStats?: {
    totalRecords?: number;
    lastSyncCount?: number;
    failedSyncCount?: number;
  };
  iconStorageId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Internal action that loads a full integration by merging file config + DB credentials.
 */
export const loadIntegration = internalAction({
  args: {
    orgSlug: v.string(),
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<LoadedIntegration | null> => {
    const [fileResult, credentials] = await Promise.all([
      ctx.runAction(
        internal.integrations.file_actions.readIntegrationForExecution,
        { orgSlug: args.orgSlug, slug: args.slug },
      ),
      ctx.runQuery(internal.integrations.credential_queries.getBySlugInternal, {
        organizationId: args.organizationId,
        slug: args.slug,
      }),
    ]);

    if (!fileResult?.ok) {
      return null;
    }

    if (!credentials) {
      return null;
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex actions return v.any(); runtime shape validated by Zod in readIntegrationForExecution
    const config = fileResult.config as {
      title: string;
      description?: string;
      version?: number;
      installed?: boolean;
      type?: 'rest_api' | 'sql';
      authMethod: string;
      supportedAuthMethods?: string[];
      secretBindings?: string[];
      allowedHosts?: string[];
      operations?: Array<{
        name: string;
        title?: string;
        description?: string;
        parametersSchema?: Record<string, unknown>;
        operationType?: 'read' | 'write';
        requiresApproval?: boolean;
        requiredScopes?: string[];
      }>;
      connectionConfig?: {
        domain?: string;
        apiVersion?: string;
        apiEndpoint?: string;
        timeout?: number;
        rateLimit?: number;
      };
      capabilities?: {
        canSync?: boolean;
        canPush?: boolean;
        canWebhook?: boolean;
        syncFrequency?: string;
      };
      oauth2Config?: {
        authorizationUrl: string;
        tokenUrl: string;
        scopes?: string[];
      };
      sqlConnectionConfig?: {
        engine: 'mssql' | 'postgres' | 'mysql';
        readOnly?: boolean;
        options?: Record<string, unknown>;
        security?: Record<string, unknown>;
      };
      sqlOperations?: Array<{
        name: string;
        title?: string;
        description?: string;
        query: string;
        parametersSchema?: Record<string, unknown>;
        operationType?: 'read' | 'write';
        requiresApproval?: boolean;
      }>;
      metadata?: Record<string, unknown>;
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action v.any() return
    const connectorCode = fileResult.connectorCode as string | null;

    // Build connector object for REST API integrations
    let connector: LoadedIntegration['connector'];
    if (connectorCode && config.type !== 'sql') {
      connector = {
        code: connectorCode,
        version: config.version ?? 1,
        operations: config.operations ?? [],
        secretBindings: config.secretBindings ?? [],
        allowedHosts: config.allowedHosts,
        timeoutMs: config.connectionConfig?.timeout,
      };
    }

    // Merge sqlConnectionConfig: file template + DB runtime
    let sqlConnectionConfig: LoadedIntegration['sqlConnectionConfig'];
    if (config.sqlConnectionConfig || credentials.sqlConnectionConfig) {
      const fileConfig = config.sqlConnectionConfig;
      const dbConfig = credentials.sqlConnectionConfig;
      sqlConnectionConfig = {
        ...(fileConfig ? fileConfig : {}),
        ...(dbConfig ? dbConfig : {}),
        engine: fileConfig?.engine ?? dbConfig?.engine ?? 'mssql',
      };
    }

    // Merge oauth2Config: file template + DB client credentials
    let oauth2Config: LoadedIntegration['oauth2Config'];
    if (config.oauth2Config || credentials.oauth2Config) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- merging file template + DB credentials with known shapes
      oauth2Config = {
        ...(config.oauth2Config ? config.oauth2Config : {}),
        ...(credentials.oauth2Config ? credentials.oauth2Config : {}),
      } as LoadedIntegration['oauth2Config'];
    }

    return {
      _id: credentials._id,
      _creationTime: credentials._creationTime,
      organizationId: credentials.organizationId,
      name: args.slug,
      title: config.title,
      description: config.description,
      type: config.type,
      status: credentials.status,
      isActive: credentials.isActive,
      authMethod: credentials.authMethod,
      supportedAuthMethods: credentials.supportedAuthMethods,
      apiKeyAuth: credentials.apiKeyAuth,
      basicAuth: credentials.basicAuth,
      oauth2Auth: credentials.oauth2Auth,
      oauth2Config,
      connectionConfig: credentials.connectionConfig ?? config.connectionConfig,
      connector,
      sqlConnectionConfig,
      sqlOperations: config.sqlOperations,
      capabilities: config.capabilities,
      lastSyncedAt: credentials.lastSyncedAt,
      lastTestedAt: credentials.lastTestedAt,
      lastSuccessAt: credentials.lastSuccessAt,
      lastErrorAt: credentials.lastErrorAt,
      errorMessage: credentials.errorMessage,
      syncStats: credentials.syncStats,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id type stored as string at runtime
      iconStorageId: credentials.iconStorageId as string | undefined,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex jsonRecordValidator returns any at type level
      metadata: credentials.metadata as Record<string, unknown> | undefined,
    };
  },
});
