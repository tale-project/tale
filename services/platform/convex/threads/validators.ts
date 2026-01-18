/**
 * Convex validators for threads operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import {
  chatTypeSchema,
  messageRoleSchema,
  threadStatusSchema,
  toolStatusSchema,
  threadMessageSchema,
  threadListItemSchema,
  latestToolMessageSchema,
  subAgentTypeSchema,
  getOrCreateSubThreadResultSchema,
} from '../../lib/shared/schemas/threads';

export {
  chatTypeSchema,
  messageRoleSchema,
  threadStatusSchema,
  toolStatusSchema,
  threadMessageSchema,
  threadListItemSchema,
} from '../../lib/shared/schemas/threads';

export const chatTypeValidator = zodToConvex(chatTypeSchema);
export const messageRoleValidator = zodToConvex(messageRoleSchema);
export const threadStatusValidator = zodToConvex(threadStatusSchema);
export const toolStatusValidator = zodToConvex(toolStatusSchema);
export const threadMessageValidator = zodToConvex(threadMessageSchema);
export const threadListItemValidator = zodToConvex(threadListItemSchema);
export const latestToolMessageValidator = zodToConvex(latestToolMessageSchema);
export const subAgentTypeValidator = zodToConvex(subAgentTypeSchema);
export const getOrCreateSubThreadResultValidator = zodToConvex(getOrCreateSubThreadResultSchema);
