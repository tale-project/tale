/**
 * Convex validators for conversation operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  conversationStatusSchema,
  conversationPrioritySchema,
  messageStatusSchema,
  messageDirectionSchema,
  messageSchema,
  customerInfoSchema,
  conversationItemSchema,
  conversationListResponseSchema,
  bulkOperationResultSchema,
  conversationDocSchema,
} from '../../lib/shared/schemas/conversations';

export {
  conversationStatusSchema,
  conversationPrioritySchema,
  messageStatusSchema,
  messageDirectionSchema,
  messageSchema,
  customerInfoSchema,
  conversationItemSchema,
} from '../../lib/shared/schemas/conversations';

export const conversationStatusValidator = zodToConvex(conversationStatusSchema);
export const conversationPriorityValidator = zodToConvex(conversationPrioritySchema);
export const messageStatusValidator = zodToConvex(messageStatusSchema);
export const messageDirectionValidator = zodToConvex(messageDirectionSchema);
export const messageValidator = zodToConvex(messageSchema);
export const customerInfoValidator = zodToConvex(customerInfoSchema);
export const conversationItemValidator = zodToConvex(conversationItemSchema);
export const conversationListResponseValidator = zodToConvex(conversationListResponseSchema);
export const bulkOperationResultValidator = zodToConvex(bulkOperationResultSchema);
export const conversationDocValidator = zodToConvex(conversationDocSchema);
