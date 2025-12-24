/**
 * Integrations API - Thin wrappers around model functions
 */

import { action, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import * as IntegrationsModel from './model/integrations';

// ============================================================================
// Public Queries
// ============================================================================

/**
 * List all integrations for an organization
 */
export const list = queryWithRLS({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await IntegrationsModel.listIntegrations(ctx, args);
  },
});

/**
 * Get a single integration by ID
 */
export const get = queryWithRLS({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await IntegrationsModel.getIntegration(ctx, args.integrationId);
  },
});

/**
 * Get integration by organization and name
 */
export const getByName = queryWithRLS({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await IntegrationsModel.getIntegrationByName(ctx, args);
  },
});

/**
 * Internal: Get integration by organization and name (no RLS)
 */
export const getByNameInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await IntegrationsModel.getIntegrationByName(ctx, args);
  },
});

/**
 * Internal: List all integrations for an organization (no RLS)
 */
export const listInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await IntegrationsModel.listIntegrations(ctx, args);
  },
});

// ============================================================================
// Public Actions (with Encryption)
// ============================================================================

/**
 * Create a new integration with encryption for credentials
 * Supports both REST API and SQL integrations
 */
export const create = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    authMethod: IntegrationsModel.authMethodValidator,
    apiKeyAuth: v.optional(IntegrationsModel.apiKeyAuthValidator),
    basicAuth: v.optional(IntegrationsModel.basicAuthValidator),
    oauth2Auth: v.optional(IntegrationsModel.oauth2AuthValidator),
    connectionConfig: v.optional(IntegrationsModel.connectionConfigValidator),
    capabilities: v.optional(IntegrationsModel.capabilitiesValidator),
    // SQL integration fields
    type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
    sqlConnectionConfig: v.optional(
      IntegrationsModel.sqlConnectionConfigValidator,
    ),
    sqlOperations: v.optional(v.array(IntegrationsModel.sqlOperationValidator)),
    metadata: v.optional(v.any()),
  },
  returns: v.id('integrations'),
  handler: async (ctx, args) => {
    return await IntegrationsModel.createIntegrationLogic(ctx, args);
  },
});

/**
 * Update an existing integration
 */
export const update = action({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(IntegrationsModel.statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(IntegrationsModel.apiKeyAuthValidator),
    basicAuth: v.optional(IntegrationsModel.basicAuthValidator),
    oauth2Auth: v.optional(IntegrationsModel.oauth2AuthValidator),
    connectionConfig: v.optional(IntegrationsModel.connectionConfigValidator),
    capabilities: v.optional(IntegrationsModel.capabilitiesValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await IntegrationsModel.updateIntegrationLogic(ctx, args);
    return null;
  },
});

/**
 * Delete an integration
 */
export const deleteIntegration = mutationWithRLS({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await IntegrationsModel.deleteIntegration(ctx, args.integrationId);
    return null;
  },
});

// Alias for consistency
export const delete_ = deleteIntegration;

/**
 * Test an integration connection
 */
export const testConnection = action({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: IntegrationsModel.testConnectionResultValidator,
  handler: async (ctx, args) => {
    return await IntegrationsModel.testConnectionLogic(ctx, args);
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Internal mutation to create integration
 * Supports both REST API and SQL integrations
 */
export const createIntegrationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: IntegrationsModel.statusValidator,
    isActive: v.boolean(),
    authMethod: IntegrationsModel.authMethodValidator,
    apiKeyAuth: v.optional(IntegrationsModel.apiKeyAuthEncryptedValidator),
    basicAuth: v.optional(IntegrationsModel.basicAuthEncryptedValidator),
    oauth2Auth: v.optional(IntegrationsModel.oauth2AuthEncryptedValidator),
    connectionConfig: v.optional(IntegrationsModel.connectionConfigValidator),
    capabilities: v.optional(IntegrationsModel.capabilitiesValidator),
    connector: v.optional(IntegrationsModel.connectorConfigValidator),
    // SQL integration fields
    type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
    sqlConnectionConfig: v.optional(
      IntegrationsModel.sqlConnectionConfigValidator,
    ),
    sqlOperations: v.optional(v.array(IntegrationsModel.sqlOperationValidator)),
    metadata: v.optional(v.any()),
  },
  returns: v.id('integrations'),
  handler: async (ctx, args) => {
    return await IntegrationsModel.createIntegrationInternal(ctx, args);
  },
});

/**
 * Internal mutation to update integration
 */
export const updateIntegrationInternal = internalMutation({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(IntegrationsModel.statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(IntegrationsModel.apiKeyAuthEncryptedValidator),
    basicAuth: v.optional(IntegrationsModel.basicAuthEncryptedValidator),
    oauth2Auth: v.optional(IntegrationsModel.oauth2AuthEncryptedValidator),
    connectionConfig: v.optional(IntegrationsModel.connectionConfigValidator),
    capabilities: v.optional(IntegrationsModel.capabilitiesValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await IntegrationsModel.updateIntegrationInternal(ctx, args);
    return null;
  },
});
