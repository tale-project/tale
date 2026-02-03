import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const ssoProvidersTable = defineTable({
  organizationId: v.string(),
  providerId: v.string(),
  issuer: v.string(),
  domain: v.string(),
  clientIdEncrypted: v.string(),
  clientSecretEncrypted: v.string(),
  scopes: v.array(v.string()),
  autoProvisionEnabled: v.boolean(),
  excludeGroups: v.array(v.string()),
  teamMembershipMode: v.union(v.literal('sync'), v.literal('additive')),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('organizationId', ['organizationId'])
  .index('domain', ['domain'])
  .index('providerId', ['providerId']);
