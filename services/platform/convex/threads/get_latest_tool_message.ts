/**
 * Get the latest tool message for a thread.
 *
 * Used to display dynamic loading status in the UI when the agent is
 * running tools. Returns the most recent tool-call or tool-result message.
 * Supports multiple tool calls in a single message.
 */

import { listMessages, type MessageDoc } from '@convex-dev/agent';

import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { QueryCtx } from '../_generated/server';

export interface LatestToolMessage {
  toolNames: string[];
  status: 'calling' | 'completed' | null;
  timestamp: number | null;
}

/**
 * Extracts all tool names from a message's content.
 * Content can be a string or an array of content parts.
 * Returns unique tool names to avoid duplicates.
 */
function extractToolNames(message: MessageDoc): string[] {
  const msg = message.message;
  if (!msg) return [];

  const content = msg.content;
  const toolNames = new Set<string>();

  // If content is an array, look for tool-call or tool-result parts
  if (Array.isArray(content)) {
    for (const part of content) {
      if (isRecord(part)) {
        if (
          (part.type === 'tool-call' || part.type === 'tool-result') &&
          typeof part.toolName === 'string'
        ) {
          toolNames.add(part.toolName);
        }
      }
    }
  }

  return Array.from(toolNames);
}

/**
 * Determines if the message represents a completed tool call.
 */
function isToolCompleted(message: MessageDoc): boolean {
  const msg = message.message;
  if (!msg) return false;

  // Tool role messages are results
  if (msg.role === 'tool') return true;

  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (isRecord(part) && part.type === 'tool-result') {
        return true;
      }
    }
  }

  return false;
}

export async function getLatestToolMessage(
  ctx: QueryCtx,
  threadId: string,
): Promise<LatestToolMessage> {
  // Get the most recent messages (not excluding tool messages)
  const result = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { cursor: null, numItems: 10 },
    // Do NOT exclude tool messages - we want them
  });

  // Find the most recent message that is tool-related
  // Messages are returned in descending order (newest first)
  for (const doc of result.page) {
    const msg = doc.message;
    if (!msg) continue;

    // Check if it's a tool role message
    if (msg.role === 'tool') {
      const toolNames = extractToolNames(doc);
      return {
        toolNames,
        status: 'completed',
        timestamp: doc._creationTime,
      };
    }

    // Check if it's an assistant message with tool-call content
    if (msg.role === 'assistant') {
      const toolNames = extractToolNames(doc);
      if (toolNames.length > 0) {
        // Check if there's a corresponding tool result
        const hasResult = result.page.some(
          (d) => d._creationTime > doc._creationTime && isToolCompleted(d),
        );
        return {
          toolNames,
          status: hasResult ? 'completed' : 'calling',
          timestamp: doc._creationTime,
        };
      }
    }
  }

  return {
    toolNames: [],
    status: null,
    timestamp: null,
  };
}
