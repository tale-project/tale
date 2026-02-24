import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  platformRoleValidator,
  providerFeaturesValidator,
  roleMappingRuleValidator,
} from './validators';

export const ssoProvidersTable = defineTable({
  organizationId: v.string(),
  providerId: v.string(),
  issuer: v.string(),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  autoProvisionRole: v.boolean(),
  roleMappingRules: v.array(roleMappingRuleValidator),
  defaultRole: platformRoleValidator,
  providerFeatures: v.optional(providerFeaturesValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('organizationId', ['organizationId'])
  .index('providerId', ['providerId']);
