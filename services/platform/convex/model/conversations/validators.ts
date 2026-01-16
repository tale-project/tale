/**
 * Convex validators for conversation model
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	conversationStatusSchema,
	conversationPrioritySchema,
	messageStatusSchema,
	messageDirectionSchema,
	attachmentSchema,
	messageSchema,
	customerInfoSchema,
	conversationItemSchema,
	conversationListResponseSchema,
	conversationWithMessagesSchema,
	bulkOperationResultSchema,
} from '../../../lib/shared/validators/conversations';

export * from '../common/validators';
export * from '../../../lib/shared/validators/conversations';
export { jsonRecordSchema, jsonRecordValidator } from '../../../lib/shared/validators/utils/json-value';

export const conversationStatusValidator = zodToConvex(conversationStatusSchema);
export const conversationPriorityValidator = zodToConvex(conversationPrioritySchema);
export const messageStatusValidator = zodToConvex(messageStatusSchema);
export const messageDirectionValidator = zodToConvex(messageDirectionSchema);
export const attachmentValidator = zodToConvex(attachmentSchema);
export const messageValidator = zodToConvex(messageSchema);
export const customerInfoValidator = zodToConvex(customerInfoSchema);
export const conversationItemValidator = zodToConvex(conversationItemSchema);
export const conversationListResponseValidator = zodToConvex(conversationListResponseSchema);
export const conversationWithMessagesValidator = zodToConvex(conversationWithMessagesSchema);
export const bulkOperationResultValidator = zodToConvex(bulkOperationResultSchema);
