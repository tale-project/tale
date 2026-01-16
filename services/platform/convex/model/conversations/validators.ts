/**
 * Convex validators for conversation model
 * Re-exports shared validators for use in Convex functions
 */

import { v } from 'convex/values';
import {
	conversationStatusValidator,
	conversationStatusSchema,
	messageStatusValidator,
	messageDirectionValidator,
	messageValidator,
	customerInfoValidator,
	attachmentValidator,
	conversationItemValidator,
	conversationListResponseValidator,
	conversationWithMessagesValidator,
	bulkOperationResultValidator,
	conversationPriorityValidator,
} from '../../../lib/shared/validators/conversations';
import { jsonRecordValidator } from '../../../lib/shared/validators/utils/json-value';
import { approvalItemValidator } from '../approvals/validators';

export * from '../common/validators';
export {
	conversationStatusValidator,
	conversationStatusSchema,
	messageStatusValidator,
	messageDirectionValidator,
	messageValidator,
	customerInfoValidator,
	attachmentValidator,
	conversationItemValidator,
	conversationListResponseValidator,
	conversationWithMessagesValidator,
	bulkOperationResultValidator,
	conversationPriorityValidator,
	jsonRecordValidator,
};

const conversationBaseFieldsWithApproval = {
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
	pendingApproval: v.optional(approvalItemValidator),
};

export const conversationItemValidatorWithApproval = v.object({
	...conversationBaseFieldsWithApproval,
});

export const conversationListResponseValidatorWithApproval = v.object({
	conversations: v.array(conversationItemValidatorWithApproval),
	total: v.number(),
	page: v.number(),
	limit: v.number(),
	totalPages: v.number(),
});

export const conversationWithMessagesValidatorWithApproval = v.object({
	...conversationBaseFieldsWithApproval,
});
