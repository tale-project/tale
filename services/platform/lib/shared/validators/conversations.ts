import { z } from 'zod';
import { v } from 'convex/values';
import { createEnumValidator } from './utils/zod-to-convex';
import { prioritySchema, priorityValidator } from './common';
import { jsonRecordSchema, jsonRecordValidator } from './utils/json-value';

export const conversationStatusLiterals = ['open', 'closed', 'spam', 'archived'] as const;
export const { zodSchema: conversationStatusSchema, convexValidator: conversationStatusValidator } =
	createEnumValidator(conversationStatusLiterals);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const conversationPrioritySchema = prioritySchema;
export const conversationPriorityValidator = priorityValidator;

export const messageStatusLiterals = ['queued', 'sent', 'delivered', 'failed'] as const;
export const { zodSchema: messageStatusSchema, convexValidator: messageStatusValidator } =
	createEnumValidator(messageStatusLiterals);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const messageDirectionLiterals = ['inbound', 'outbound'] as const;
export const { zodSchema: messageDirectionSchema, convexValidator: messageDirectionValidator } =
	createEnumValidator(messageDirectionLiterals);
export type MessageDirection = z.infer<typeof messageDirectionSchema>;

export const attachmentSchema = z.object({
	url: z.string(),
	filename: z.string(),
	contentType: z.string().optional(),
	size: z.number().optional(),
});

export const attachmentValidator = v.object({
	url: v.string(),
	filename: v.string(),
	contentType: v.optional(v.string()),
	size: v.optional(v.number()),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const messageSchema = z.object({
	id: z.string(),
	sender: z.string(),
	content: z.string(),
	timestamp: z.string(),
	isCustomer: z.boolean(),
	status: messageStatusSchema,
	attachment: attachmentSchema.optional(),
});

export const messageValidator = v.object({
	id: v.string(),
	sender: v.string(),
	content: v.string(),
	timestamp: v.string(),
	isCustomer: v.boolean(),
	status: messageStatusValidator,
	attachment: v.optional(attachmentValidator),
});

export type Message = z.infer<typeof messageSchema>;

export const customerInfoSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	email: z.string(),
	locale: z.string().optional(),
	status: z.string(),
	source: z.string().optional(),
	created_at: z.string(),
});

export const customerInfoValidator = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	email: v.string(),
	locale: v.optional(v.string()),
	status: v.string(),
	source: v.optional(v.string()),
	created_at: v.string(),
});

export type CustomerInfo = z.infer<typeof customerInfoSchema>;

const conversationBaseFieldsSchema = {
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	customerId: z.string().optional(),
	externalMessageId: z.string().optional(),
	subject: z.string().optional(),
	status: conversationStatusSchema.optional(),
	priority: z.string().optional(),
	type: z.string().optional(),
	channel: z.string().optional(),
	direction: messageDirectionSchema.optional(),
	providerId: z.string().optional(),
	lastMessageAt: z.number().optional(),
	metadata: jsonRecordSchema.optional(),
	id: z.string(),
	title: z.string(),
	description: z.string(),
	customer_id: z.string(),
	business_id: z.string(),
	message_count: z.number(),
	unread_count: z.number(),
	last_message_at: z.string().optional(),
	last_read_at: z.string().optional(),
	resolved_at: z.string().optional(),
	resolved_by: z.string().optional(),
	created_at: z.string(),
	updated_at: z.string(),
	customer: customerInfoSchema,
	messages: z.array(messageSchema),
};

const conversationBaseFieldsValidator = {
	_id: v.id('conversations'),
	_creationTime: v.number(),
	organizationId: v.string(),
	customerId: v.optional(v.id('customers')),
	externalMessageId: v.optional(v.string()),
	subject: v.optional(v.string()),
	status: v.optional(conversationStatusValidator),
	priority: v.optional(v.string()),
	type: v.optional(v.string()),
	channel: v.optional(v.string()),
	direction: v.optional(messageDirectionValidator),
	providerId: v.optional(v.id('emailProviders')),
	lastMessageAt: v.optional(v.number()),
	metadata: v.optional(jsonRecordValidator),
	id: v.string(),
	title: v.string(),
	description: v.string(),
	customer_id: v.string(),
	business_id: v.string(),
	message_count: v.number(),
	unread_count: v.number(),
	last_message_at: v.optional(v.string()),
	last_read_at: v.optional(v.string()),
	resolved_at: v.optional(v.string()),
	resolved_by: v.optional(v.string()),
	created_at: v.string(),
	updated_at: v.string(),
	customer: customerInfoValidator,
	messages: v.array(messageValidator),
};

export const conversationItemSchema = z.object(conversationBaseFieldsSchema);

export const conversationItemValidator = v.object(conversationBaseFieldsValidator);

export type ConversationItem = z.infer<typeof conversationItemSchema>;

export const conversationListResponseSchema = z.object({
	conversations: z.array(conversationItemSchema),
	total: z.number(),
	page: z.number(),
	limit: z.number(),
	totalPages: z.number(),
});

export const conversationListResponseValidator = v.object({
	conversations: v.array(conversationItemValidator),
	total: v.number(),
	page: v.number(),
	limit: v.number(),
	totalPages: v.number(),
});

export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

export const conversationWithMessagesSchema = z.object(conversationBaseFieldsSchema);

export const conversationWithMessagesValidator = v.object(conversationBaseFieldsValidator);

export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

export const bulkOperationResultSchema = z.object({
	successCount: z.number(),
	failedCount: z.number(),
	errors: z.array(z.string()),
});

export const bulkOperationResultValidator = v.object({
	successCount: v.number(),
	failedCount: v.number(),
	errors: v.array(v.string()),
});

export type BulkOperationResult = z.infer<typeof bulkOperationResultSchema>;
