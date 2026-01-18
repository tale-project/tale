import { z } from 'zod/v4';

export const chatTypeLiterals = ['general', 'workflow_assistant'] as const;
export const chatTypeSchema = z.enum(chatTypeLiterals);
export type ChatType = z.infer<typeof chatTypeSchema>;

export const messageRoleLiterals = ['user', 'assistant'] as const;
export const messageRoleSchema = z.enum(messageRoleLiterals);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const threadStatusLiterals = ['active', 'archived'] as const;
export const threadStatusSchema = z.enum(threadStatusLiterals);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const toolStatusLiterals = ['calling', 'completed'] as const;
export const toolStatusSchema = z.union([z.enum(toolStatusLiterals), z.null()]);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

export const threadMessageSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	role: messageRoleSchema,
	content: z.string(),
});

export type ThreadMessage = z.infer<typeof threadMessageSchema>;

export const threadMessagesResponseSchema = z.object({
	messages: z.array(threadMessageSchema),
});

export type ThreadMessagesResponse = z.infer<typeof threadMessagesResponseSchema>;

export const threadListItemSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	title: z.string().optional(),
	status: threadStatusSchema,
	userId: z.string().optional(),
});

export type ThreadListItem = z.infer<typeof threadListItemSchema>;

export const latestToolMessageSchema = z.object({
	toolNames: z.array(z.string()),
	status: toolStatusSchema,
	timestamp: z.number().nullable(),
});

export type LatestToolMessage = z.infer<typeof latestToolMessageSchema>;

export const subAgentTypeLiterals = [
	'web_assistant',
	'document_assistant',
	'integration_assistant',
	'workflow_assistant',
	'crm_assistant',
] as const;
export const subAgentTypeSchema = z.enum(subAgentTypeLiterals);
export type SubAgentType = z.infer<typeof subAgentTypeSchema>;

export const getOrCreateSubThreadResultSchema = z.object({
	threadId: z.string(),
	isNew: z.boolean(),
});

export type GetOrCreateSubThreadResult = z.infer<typeof getOrCreateSubThreadResultSchema>;
