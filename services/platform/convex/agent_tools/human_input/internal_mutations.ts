import { v } from 'convex/values';

import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

import { internalMutation } from '../../_generated/server';
import {
  createApproval,
  listPendingApprovalsForExecution,
} from '../../approvals/helpers';
import { toId } from '../../lib/type_cast_helpers';

const fieldTypeValidator = v.union(
  v.literal('text'),
  v.literal('textarea'),
  v.literal('number'),
  v.literal('email'),
  v.literal('url'),
  v.literal('tel'),
  v.literal('single_select'),
  v.literal('multi_select'),
  v.literal('yes_no'),
);

const optionValidator = v.object({
  label: v.string(),
  description: v.optional(v.string()),
  value: v.optional(v.string()),
});

const fieldValidator = v.object({
  label: v.string(),
  description: v.optional(v.string()),
  required: v.optional(v.boolean()),
  type: fieldTypeValidator,
  options: v.optional(v.array(optionValidator)),
});

export const createHumanInputRequest = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    question: v.string(),
    context: v.optional(v.string()),
    fields: v.array(fieldValidator),
    messageId: v.optional(v.string()),
    wfExecutionId: v.optional(v.string()),
    stepSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency guard for workflow context: if a pending human_input_request
    // already exists for this execution+step, return it instead of creating a duplicate
    if (args.wfExecutionId && args.stepSlug) {
      const existing = await listPendingApprovalsForExecution(
        ctx,
        toId<'wfExecutions'>(args.wfExecutionId),
      );
      const duplicate = existing.find(
        (a) =>
          a.resourceType === 'human_input_request' &&
          a.stepSlug === args.stepSlug,
      );
      if (duplicate) {
        return duplicate._id;
      }
    }

    // Validate: select/yes_no fields must have options
    for (const field of args.fields) {
      if (
        (field.type === 'single_select' || field.type === 'multi_select') &&
        (!field.options || field.options.length < 2)
      ) {
        throw new Error(
          `Field "${field.label}" with type "${field.type}" requires at least 2 options`,
        );
      }
      if (field.type === 'yes_no' && !field.options) {
        throw new Error(
          `Field "${field.label}" with type "yes_no" requires options`,
        );
      }
      if (field.options && field.options.length > 0) {
        const values = field.options.map((opt) => opt.value ?? opt.label);
        if (new Set(values).size !== values.length) {
          throw new Error(
            `Field "${field.label}" has duplicate option values. Each option must resolve to a unique value.`,
          );
        }
      }
    }

    // Map flat Convex validator fields to the Zod discriminated union shape
    const typedFields: HumanInputRequestMetadata['fields'] = args.fields.map(
      (field) => {
        const base = {
          label: field.label,
          description: field.description,
          required: field.required,
        };
        switch (field.type) {
          case 'single_select':
          case 'multi_select':
            return { ...base, type: field.type, options: field.options ?? [] };
          case 'yes_no':
            return { ...base, type: field.type, options: field.options };
          default:
            return { ...base, type: field.type };
        }
      },
    );

    const metadata: HumanInputRequestMetadata = {
      question: args.question,
      context: args.context,
      fields: typedFields,
      requestedAt: Date.now(),
    };

    const resourceId = `human_input:${args.threadId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'human_input_request',
      resourceId,
      priority: 'medium',
      description: args.question,
      threadId: args.threadId,
      messageId: args.messageId,
      wfExecutionId: args.wfExecutionId
        ? toId<'wfExecutions'>(args.wfExecutionId)
        : undefined,
      stepSlug: args.stepSlug,
      metadata,
    });

    return approvalId;
  },
});
