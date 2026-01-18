/**
 * Internal mutation to update integration
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import {
  statusValidator,
  apiKeyAuthEncryptedValidator,
  basicAuthEncryptedValidator,
  oauth2AuthEncryptedValidator,
  connectionConfigValidator,
  capabilitiesValidator,
} from '../validators';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export const updateIntegrationInternal = internalMutation({
  args: {
    integrationId: v.id('integrations'),
    status: v.optional(statusValidator),
    isActive: v.optional(v.boolean()),
    apiKeyAuth: v.optional(apiKeyAuthEncryptedValidator),
    basicAuth: v.optional(basicAuthEncryptedValidator),
    oauth2Auth: v.optional(oauth2AuthEncryptedValidator),
    connectionConfig: v.optional(connectionConfigValidator),
    capabilities: v.optional(capabilitiesValidator),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const { integrationId, ...updates } = args;

    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(integrationId, cleanUpdates);
  },
});
