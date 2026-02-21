import { z } from 'zod/v4';

const chatTypeLiterals = [
  'general',
  'workflow_assistant',
  'agent_test',
] as const;
export const chatTypeSchema = z.enum(chatTypeLiterals);
type ChatType = z.infer<typeof chatTypeSchema>;

const messageRoleLiterals = ['user', 'assistant'] as const;
export const messageRoleSchema = z.enum(messageRoleLiterals);
type MessageRole = z.infer<typeof messageRoleSchema>;

const threadStatusLiterals = ['active', 'archived'] as const;
export const threadStatusSchema = z.enum(threadStatusLiterals);
type ThreadStatus = z.infer<typeof threadStatusSchema>;

const toolStatusLiterals = ['calling', 'completed'] as const;
export const toolStatusSchema = z.union([z.enum(toolStatusLiterals), z.null()]);
type ToolStatus = z.infer<typeof toolStatusSchema>;

export const threadMessageSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  role: messageRoleSchema,
  content: z.string(),
});

type ThreadMessage = z.infer<typeof threadMessageSchema>;

const threadMessagesResponseSchema = z.object({
  messages: z.array(threadMessageSchema),
});

type ThreadMessagesResponse = z.infer<typeof threadMessagesResponseSchema>;

export const threadListItemSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  title: z.string().optional(),
  status: threadStatusSchema,
  userId: z.string().optional(),
});

type ThreadListItem = z.infer<typeof threadListItemSchema>;

export const latestToolMessageSchema = z.object({
  toolNames: z.array(z.string()),
  status: toolStatusSchema,
  timestamp: z.number().nullable(),
});

type LatestToolMessage = z.infer<typeof latestToolMessageSchema>;

export const getOrCreateSubThreadResultSchema = z.object({
  threadId: z.string(),
  isNew: z.boolean(),
});

type GetOrCreateSubThreadResult = z.infer<
  typeof getOrCreateSubThreadResultSchema
>;
