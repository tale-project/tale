import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Emit the governance-policy audit-log entry for a file write. The write itself
 * happens in the `'use node'` action (filesystem); audit emission must run in a
 * mutation (hash-chain genesis OCC), so the action delegates here. Governance-
 * specific — kept out of the domain-agnostic `lib/config_cache` module.
 */
export const recordGovernancePolicyAudit = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    policyType: v.string(),
    created: v.boolean(),
    previousConfig: v.optional(jsonRecordValidator),
    newConfig: jsonRecordValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: 'user',
      action: args.created ? 'policy.created' : 'policy.updated',
      category: 'security',
      resourceType: 'governance_policy',
      resourceId: args.policyType,
      resourceName: `Policy: ${args.policyType}`,
      previousState: args.previousConfig
        ? { config: args.previousConfig }
        : undefined,
      newState: { config: args.newConfig },
      status: 'success',
    });
    return null;
  },
});
