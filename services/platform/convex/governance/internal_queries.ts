import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getPiiConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'pii_config'),
      )
      .first();
  },
});

export const getSystemPromptPolicyInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'system_prompt'),
      )
      .first();
  },
});

export const listRetentionPolicies = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const policies = [];
    for await (const policy of ctx.db.query('governancePolicies')) {
      if (policy.policyType === 'retention_policy') {
        policies.push(policy);
      }
    }
    return policies;
  },
});

export const listExpiredTempFiles = internalQuery({
  args: {
    organizationId: v.string(),
    source: v.union(v.literal('user'), v.literal('agent')),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = [];
    for await (const file of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_source_and_documentId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('source', args.source)
          .eq('documentId', undefined),
      )) {
      if (file._creationTime < args.cutoffMs) {
        files.push(file);
        if (files.length >= args.batchSize) {
          break;
        }
      }
    }
    return files;
  },
});

export const listExpiredDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const docs = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (doc._creationTime < args.cutoffMs) {
        docs.push(doc);
        if (docs.length >= args.batchSize) {
          break;
        }
      }
    }
    return docs;
  },
});
