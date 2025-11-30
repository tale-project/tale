import type { PaginationResult } from 'convex/server';

// Minimal structural types to describe the agent messages we care about for
// deduplication. These intentionally only include the fields we read.

export interface AgentMessage {
  _id: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export type AgentListMessagesResult = PaginationResult<AgentMessage>;

export interface DeduplicationState {
  latestMessage: AgentMessage | undefined;
  lastUserMessage: AgentMessage | undefined;
  messageAlreadyExists: boolean;
  trimmedMessage: string;
}

export function computeDeduplicationState(
  existingMessages: AgentListMessagesResult,
  incomingMessage: string,
): DeduplicationState {
  // Determine the latest non-tool message in the thread
  const latestMessage = existingMessages.page[0];
  const latestIsAssistantWithContent =
    latestMessage?.message?.role === 'assistant' &&
    latestMessage.message?.content != null;

  // Find the most recent user message (used for deduplication when appropriate)
  const lastUserMessage = existingMessages.page.find(
    (msg) => msg.message?.role === 'user',
  );

  const lastUserContent =
    typeof lastUserMessage?.message?.content === 'string'
      ? lastUserMessage.message.content.trim()
      : '';

  const trimmedMessage = incomingMessage.trim();
  // If the latest message is a non-null assistant message, always treat the
  // user input as a new message (skip deduplication). Otherwise, fall back
  // to the previous "same-as-last-user" deduplication behavior.
  const messageAlreadyExists =
    !latestIsAssistantWithContent && lastUserContent === trimmedMessage;

  return {
    latestMessage,
    lastUserMessage,
    messageAlreadyExists,
    trimmedMessage,
  };
}
