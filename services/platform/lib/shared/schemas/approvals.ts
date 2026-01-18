import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';
import { prioritySchema } from './common';

export const approvalStatusLiterals = ['pending', 'approved', 'rejected'] as const;
export const approvalStatusSchema = z.enum(approvalStatusLiterals);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalPrioritySchema = prioritySchema;
export type ApprovalPriority = z.infer<typeof approvalPrioritySchema>;

export const approvalResourceTypeLiterals = [
	'conversations',
	'product_recommendation',
	'integration_operation',
	'workflow_creation',
] as const;
export const approvalResourceTypeSchema = z.enum(approvalResourceTypeLiterals);
export type ApprovalResourceType = z.infer<typeof approvalResourceTypeSchema>;

export const approvalItemSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	wfExecutionId: z.string().optional(),
	stepSlug: z.string().optional(),
	status: approvalStatusSchema,
	approvedBy: z.string().optional(),
	reviewedAt: z.number().optional(),
	resourceType: approvalResourceTypeSchema,
	resourceId: z.string(),
	priority: approvalPrioritySchema,
	dueDate: z.number().optional(),
	executedAt: z.number().optional(),
	executionError: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
	threadId: z.string().optional(),
	messageId: z.string().optional(),
});

export type ApprovalItem = z.infer<typeof approvalItemSchema>;
