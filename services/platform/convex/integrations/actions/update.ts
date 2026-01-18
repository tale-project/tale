'use node';

/**
 * Public action to update an integration
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { updateIntegrationLogic } from '../update_integration_logic';
import {
  statusValidator,
  apiKeyAuthValidator,
  basicAuthValidator,
  oauth2AuthValidator,
  connectionConfigValidator,
  capabilitiesValidator,
} from '../validators';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export const update = action({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(apiKeyAuthValidator),
    basicAuth: v.optional(basicAuthValidator),
    oauth2Auth: v.optional(oauth2AuthValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await updateIntegrationLogic(ctx, args);
    return null;
  },
});
