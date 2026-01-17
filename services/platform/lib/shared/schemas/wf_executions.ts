import { z } from 'zod';
import { jsonRecordSchema, jsonValueSchema } from './utils/json-value';
import { sortOrderLiterals } from './common';

export const executionSortOrderSchema = z.enum(sortOrderLiterals);
export type ExecutionSortOrder = z.infer<typeof executionSortOrderSchema>;

export const updateExecutionStatusArgsSchema = z.object({
	executionId: z.string(),
	status: z.string(),
	currentStepSlug: z.string().optional(),
	waitingFor: z.string().optional(),
	error: z.string().optional(),
});

export type UpdateExecutionStatusArgs = z.infer<typeof updateExecutionStatusArgsSchema>;

export const completeExecutionArgsSchema = z.object({
	executionId: z.string(),
	output: jsonValueSchema,
	variablesSerialized: z.string().optional(),
	variablesStorageId: z.string().optional(),
});

export type CompleteExecutionArgs = z.infer<typeof completeExecutionArgsSchema>;

export const failExecutionArgsSchema = z.object({
	executionId: z.string(),
	error: z.string(),
});

export type FailExecutionArgs = z.infer<typeof failExecutionArgsSchema>;

export const patchExecutionArgsSchema = z.object({
	executionId: z.string(),
	updates: z.object({
		threadId: z.string().optional(),
		currentStepSlug: z.string().optional(),
		variables: z.string().optional(),
		metadata: z.string().optional(),
	}),
});

export type PatchExecutionArgs = z.infer<typeof patchExecutionArgsSchema>;

export const resumeExecutionArgsSchema = z.object({
	executionId: z.string(),
	variablesSerialized: z.string().optional(),
	variablesStorageId: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
});

export type ResumeExecutionArgs = z.infer<typeof resumeExecutionArgsSchema>;

export const setComponentWorkflowArgsSchema = z.object({
	executionId: z.string(),
	componentWorkflowId: z.string(),
});

export type SetComponentWorkflowArgs = z.infer<typeof setComponentWorkflowArgsSchema>;

export const updateExecutionMetadataArgsSchema = z.object({
	executionId: z.string(),
	metadata: jsonRecordSchema,
});

export type UpdateExecutionMetadataArgs = z.infer<typeof updateExecutionMetadataArgsSchema>;

export const updateExecutionVariablesArgsSchema = z.object({
	executionId: z.string(),
	variablesSerialized: z.string().optional(),
	variablesStorageId: z.string().optional(),
});

export type UpdateExecutionVariablesArgs = z.infer<typeof updateExecutionVariablesArgsSchema>;

export const listExecutionsArgsSchema = z.object({
	wfDefinitionId: z.string(),
	status: z.string().optional(),
	limit: z.number().optional(),
	search: z.string().optional(),
	triggeredBy: z.string().optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
});

export type ListExecutionsArgs = z.infer<typeof listExecutionsArgsSchema>;

export const listExecutionsPaginatedArgsSchema = z.object({
	wfDefinitionId: z.string(),
	organizationId: z.string().optional(),
	currentPage: z.number().optional(),
	pageSize: z.number().optional(),
	searchTerm: z.string().optional(),
	status: z.array(z.string()).optional(),
	triggeredBy: z.array(z.string()).optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
	sortField: z.string().optional(),
	sortOrder: executionSortOrderSchema.optional(),
});

export type ListExecutionsPaginatedArgs = z.infer<typeof listExecutionsPaginatedArgsSchema>;

export const listExecutionsCursorArgsSchema = z.object({
	wfDefinitionId: z.string(),
	numItems: z.number().optional(),
	cursor: z.string().nullable(),
	searchTerm: z.string().optional(),
	status: z.array(z.string()).optional(),
	triggeredBy: z.array(z.string()).optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
});

export type ListExecutionsCursorArgs = z.infer<typeof listExecutionsCursorArgsSchema>;
