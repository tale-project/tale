import { z } from 'zod';
import { jsonRecordSchema } from './utils/json-value';

export const workflowStatusLiterals = ['draft', 'active', 'archived'] as const;
export const workflowStatusSchema = z.enum(workflowStatusLiterals);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

export const workflowTypeLiterals = ['predefined'] as const;
export const workflowTypeSchema = z.literal('predefined');
export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const retryPolicySchema = z.object({
	maxRetries: z.number(),
	backoffMs: z.number(),
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const secretConfigSchema = z.object({
	kind: z.literal('inlineEncrypted'),
	cipherText: z.string(),
	keyId: z.string().optional(),
});

export type SecretConfig = z.infer<typeof secretConfigSchema>;

export const workflowConfigSchema = z.object({
	timeout: z.number().optional(),
	retryPolicy: retryPolicySchema.optional(),
	variables: jsonRecordSchema.optional(),
	secrets: z.record(z.string(), secretConfigSchema).optional(),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

export const workflowUpdateSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	version: z.string().optional(),
	status: workflowStatusSchema.optional(),
	workflowType: workflowTypeSchema.optional(),
	config: workflowConfigSchema.optional(),
	metadata: jsonRecordSchema.optional(),
});

export type WorkflowUpdate = z.infer<typeof workflowUpdateSchema>;
