import { z } from 'zod/v4';

import { prioritySchema } from './common';
import { jsonRecordSchema } from './utils/json-value';

const approvalStatusLiterals = ['pending', 'approved', 'rejected'] as const;
export const approvalStatusSchema = z.enum(approvalStatusLiterals);
type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalPrioritySchema = prioritySchema;
type ApprovalPriority = z.infer<typeof approvalPrioritySchema>;

const approvalResourceTypeLiterals = [
  'conversations',
  'product_recommendation',
  'integration_operation',
  'workflow_creation',
  'human_input_request',
] as const;
export const approvalResourceTypeSchema = z.enum(approvalResourceTypeLiterals);
type ApprovalResourceType = z.infer<typeof approvalResourceTypeSchema>;

const approvalItemSchema = z.object({
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

type ApprovalItem = z.infer<typeof approvalItemSchema>;

const humanInputFormatLiterals = [
  'single_select',
  'multi_select',
  'text_input',
  'yes_no',
] as const;
const humanInputFormatSchema = z.enum(humanInputFormatLiterals);
type HumanInputFormat = z.infer<typeof humanInputFormatSchema>;

const humanInputOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
});
type HumanInputOption = z.infer<typeof humanInputOptionSchema>;

const humanInputResponseSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  respondedBy: z.string(),
  timestamp: z.number(),
});
type HumanInputResponse = z.infer<typeof humanInputResponseSchema>;

export const humanInputRequestMetadataSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  format: humanInputFormatSchema,
  options: z.array(humanInputOptionSchema).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  requestedAt: z.number(),
  response: humanInputResponseSchema.optional(),
});
export type HumanInputRequestMetadata = z.infer<
  typeof humanInputRequestMetadataSchema
>;
