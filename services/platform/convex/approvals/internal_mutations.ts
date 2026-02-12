import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import {
  approvalResourceTypeValidator,
  approvalPriorityValidator,
} from './validators';

export const createApproval = internalMutation({
  args: {
    organizationId: v.string(),
    resourceType: approvalResourceTypeValidator,
    resourceId: v.string(),
    priority: approvalPriorityValidator,
    requestedBy: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    description: v.optional(v.string()),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    stepSlug: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    return await ApprovalsHelpers.createApproval(ctx, args);
  },
});

export const linkApprovalsToMessage = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    return await ApprovalsHelpers.linkApprovalsToMessage(ctx, args);
  },
});
