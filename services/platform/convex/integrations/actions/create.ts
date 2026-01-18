'use node';

/**
 * Public action to create an integration
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { createIntegrationLogic } from '../create_integration_logic';
import {
  authMethodValidator,
  apiKeyAuthValidator,
  basicAuthValidator,
  oauth2AuthValidator,
  connectionConfigValidator,
  capabilitiesValidator,
  sqlConnectionConfigValidator,
  sqlOperationValidator,
} from '../validators';
import { jsonValueValidator } from '../../../lib/shared/schemas/utils/json-value';

export const create = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    authMethod: authMethodValidator,
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
    sqlConnectionConfig: v.optional(sqlConnectionConfigValidator),
    sqlOperations: v.optional(v.array(sqlOperationValidator)),
    metadata: v.optional(jsonValueValidator),
  },
  returns: v.id('integrations'),
  handler: async (ctx, args): Promise<Id<'integrations'>> => {
    return await createIntegrationLogic(ctx, args);
  },
});
