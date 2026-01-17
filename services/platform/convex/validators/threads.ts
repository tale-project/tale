/**
 * Convex validators for threads model
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  chatTypeSchema,
  messageRoleSchema,
  threadStatusSchema,
  toolStatusSchema,
  threadMessageSchema,
  threadMessagesResponseSchema,
  threadListItemSchema,
  latestToolMessageSchema,
  subAgentTypeSchema,
  getOrCreateSubThreadResultSchema,
} from '../../lib/shared/schemas/threads';

export const chatTypeValidator = zodToConvex(chatTypeSchema);
export const messageRoleValidator = zodToConvex(messageRoleSchema);
export const threadStatusValidator = zodToConvex(threadStatusSchema);
export const toolStatusValidator = zodToConvex(toolStatusSchema);
export const threadMessageValidator = zodToConvex(threadMessageSchema);
export const threadMessagesResponseValidator = zodToConvex(threadMessagesResponseSchema);
export const threadListItemValidator = zodToConvex(threadListItemSchema);
export const latestToolMessageValidator = zodToConvex(latestToolMessageSchema);
export const subAgentTypeValidator = zodToConvex(subAgentTypeSchema);
export const getOrCreateSubThreadResultValidator = zodToConvex(getOrCreateSubThreadResultSchema);
