/**
 * Context Summarization for Long Conversations
 *
 * CHUNKED INCREMENTAL SUMMARIZATION:
 * - Never truncates content - all information is preserved
 * - If total tokens exceed limit, summarizes in chunks based on token count
 * - Each chunk builds on the previous summary (rolling/hierarchical)
 * - Example: 100K tokens → multiple iterations until all processed
 */

import { Agent } from '@convex-dev/agent';
import type { ActionCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { openai } from './openai_provider';

import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

/**
 * Message structure for summarization - includes tool messages
 */
export interface MessageForSummary {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Tool name if this is a tool result */
  toolName?: string;
}

/**
 * Maximum tokens per chunk for summarization.
 * Set conservatively to fit within most LLM context limits with room for output.
 * Using ~4 chars per token as estimate.
 */
const MAX_CHUNK_TOKENS = 50000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

const SUMMARIZATION_INSTRUCTIONS = `You are a conversation summarizer. Your task is to create a comprehensive summary of conversation history that preserves important context for an AI assistant.

Guidelines:
1. **Preserve key data from tool results** - URLs fetched, search results, API responses, product info, customer details
2. Capture facts, decisions, and conclusions reached
3. Keep user preferences, corrections, and requirements
4. Note unresolved questions or pending topics
5. Include specific names, numbers, dates, and identifiers mentioned
6. If an existing summary is provided, incorporate and update it with new information

Format the summary with clear sections:
- **Key Data & Findings**: Important data retrieved from tools
- **User Requirements**: What the user wants/needs
- **Decisions & Conclusions**: What was decided or concluded
- **Pending Items**: Unresolved questions or next steps

Keep the summary factual and structured. Use bullet points for clarity.`;

const INCREMENTAL_SUMMARIZATION_INSTRUCTIONS = `You are a conversation summarizer. Your task is to UPDATE an existing summary with new conversation information.

You will receive:
1. An existing summary of older conversation
2. New messages that occurred after that summary

Guidelines:
1. **Merge new information** into the existing summary structure
2. **Preserve key data from tool results** - URLs, search results, API responses
3. **Update or add** facts, decisions, findings from new messages
4. **Remove outdated info** if new messages contradict or supersede it
5. Keep the same format structure as the existing summary

Output ONLY the updated summary, not commentary about changes.`;

/**
 * Create a lightweight summarizer agent (no tools, just for summarization)
 */
function createSummarizerAgent(incremental: boolean = false): Agent {
  const envModel = (process.env.OPENAI_MODEL || '').trim();
  if (!envModel) {
    throw new Error(
      'OPENAI_MODEL environment variable is required for summarization',
    );
  }

  return new Agent(components.agent, {
    name: 'summarizer',
    languageModel: openai.chat(envModel),
    instructions: incremental
      ? INCREMENTAL_SUMMARIZATION_INSTRUCTIONS
      : SUMMARIZATION_INSTRUCTIONS,
    // Set maxOutputTokens to ensure the model has room to respond (OpenRouter may default to low values)
    providerOptions: { openai: { maxOutputTokens: 8192 } },
  });
}

/**
 * Format messages for summarization - NO truncation, preserves all content.
 */
function formatMessagesForSummary(messages: MessageForSummary[]): string {
  const formatted: string[] = [];

  for (const m of messages) {
    let line: string;
    if (m.role === 'tool' && m.toolName) {
      line = `TOOL RESULT (${m.toolName}): ${m.content}`;
    } else {
      line = `${m.role.toUpperCase()}: ${m.content}`;
    }
    formatted.push(line);
  }

  return formatted.join('\n\n');
}

/**
 * Estimate token count for a message (using chars / CHARS_PER_TOKEN_ESTIMATE).
 */
function estimateTokens(message: MessageForSummary): number {
  const overhead = message.toolName ? message.toolName.length + 20 : 10; // role prefix
  return Math.ceil(
    (message.content.length + overhead) / CHARS_PER_TOKEN_ESTIMATE,
  );
}

/**
 * Split messages into token-based chunks.
 * Each chunk will have at most MAX_CHUNK_TOKENS worth of content.
 */
function splitIntoTokenChunks(
  messages: MessageForSummary[],
): MessageForSummary[][] {
  const chunks: MessageForSummary[][] = [];
  let currentChunk: MessageForSummary[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message);

    // If single message exceeds limit, it gets its own chunk
    if (messageTokens >= MAX_CHUNK_TOKENS) {
      // Flush current chunk if not empty
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      // Add large message as its own chunk
      chunks.push([message]);
      continue;
    }

    // If adding this message would exceed limit, start new chunk
    if (
      currentTokens + messageTokens > MAX_CHUNK_TOKENS &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Summarize a list of messages into a condensed context summary.
 *
 * TOKEN-BASED CHUNKED SUMMARIZATION:
 * If total tokens exceed MAX_CHUNK_TOKENS, processes them in chunks:
 * - Chunk 1 (up to 50K tokens) → Summary A
 * - Chunk 2 (next 50K tokens) → Summary B = Summary A + chunk 2
 * - Chunk 3 (next 50K tokens) → Summary C = Summary B + chunk 3
 * - ... and so on
 *
 * This ensures no information is lost even with very long conversations,
 * and handles cases where a single message might have many tokens.
 *
 * @param ctx - Action context
 * @param messages - The messages to summarize (including tool messages)
 * @param currentPrompt - The current user prompt to focus summarization on relevant context
 * @returns A condensed summary of the conversation context
 */
export async function summarizeMessages(
  ctx: ActionCtx,
  messages: MessageForSummary[],
  currentPrompt?: string,
): Promise<string> {
  if (messages.length === 0) {
    debugLog('summarizeMessages No messages to summarize');
    return '';
  }

  // Split messages into token-based chunks
  const chunks = splitIntoTokenChunks(messages);

  // If only one chunk, summarize directly
  if (chunks.length === 1) {
    return await summarizeSingleChunk(ctx, chunks[0], currentPrompt);
  }

  // CHUNKED SUMMARIZATION: process multiple chunks
  const totalTokensEstimate = messages.reduce(
    (sum, m) => sum + estimateTokens(m),
    0,
  );
  debugLog(
    `summarizeMessages Chunked summarization: ${messages.length} messages, ~${totalTokensEstimate} tokens, ${chunks.length} chunks`,
  );

  let rollingSummary = '';
  let processedMessages = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const chunkTokens = chunk.reduce((sum, m) => sum + estimateTokens(m), 0);

    debugLog(
      `summarizeMessages Processing chunk ${chunkIndex + 1}/${chunks.length}: ${chunk.length} messages, ~${chunkTokens} tokens`,
    );

    if (chunkIndex === 0) {
      // First chunk: create initial summary
      rollingSummary = await summarizeSingleChunk(ctx, chunk, currentPrompt);
    } else {
      // Subsequent chunks: update existing summary with new messages
      rollingSummary = await updateSummary(
        ctx,
        rollingSummary,
        chunk,
        currentPrompt,
      );
    }

    processedMessages += chunk.length;
    debugLog(
      `summarizeMessages Chunk ${chunkIndex + 1} complete, rolling summary: ${rollingSummary.length} chars`,
    );
  }

  debugLog(
    `summarizeMessages Chunked summarization complete: ${processedMessages} messages → ${rollingSummary.length} chars`,
  );

  return rollingSummary;
}

/**
 * Summarize a single chunk of messages (used internally).
 */
async function summarizeSingleChunk(
  ctx: ActionCtx,
  messages: MessageForSummary[],
  currentPrompt?: string,
): Promise<string> {
  const formattedMessages = formatMessagesForSummary(messages);
  debugLog(
    `summarizeSingleChunk Formatted ${messages.length} messages, total chars: ${formattedMessages.length}`,
  );

  const summarizer = createSummarizerAgent(false);

  let prompt = '';
  if (currentPrompt) {
    prompt = `The user is now asking: "${currentPrompt}"

Summarize the following conversation history, prioritizing information relevant to the user's current question:

${formattedMessages}`;
  } else {
    prompt = `Summarize this conversation:\n\n${formattedMessages}`;
  }

  // Generate unique userId for one-off summarization (messages won't be saved)
  const userId = `summarizer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const result = await summarizer.generateText(
    ctx,
    { userId },
    { prompt },
    { storageOptions: { saveMessages: 'none' } },
  );

  if (!result.text) {
    throw new Error(
      '[summarizeSingleChunk] Summarizer returned empty text - no summary generated',
    );
  }

  return result.text;
}

/**
 * Incrementally update an existing summary with new messages.
 * This is more efficient than re-summarizing everything.
 *
 * @param ctx - Action context
 * @param existingSummary - The previous summary to update
 * @param newMessages - New messages since the last summary
 * @param currentPrompt - The current user prompt for context
 * @returns Updated summary incorporating new information
 */
export async function updateSummary(
  ctx: ActionCtx,
  existingSummary: string,
  newMessages: MessageForSummary[],
  currentPrompt?: string,
): Promise<string> {
  if (newMessages.length === 0) {
    return existingSummary;
  }

  const formattedNewMessages = formatMessagesForSummary(newMessages);
  const summarizer = createSummarizerAgent(true);

  let prompt = `## Existing Summary

${existingSummary}

## New Messages to Incorporate

${formattedNewMessages}`;

  if (currentPrompt) {
    prompt += `\n\n## Current User Question (for context)\n\n"${currentPrompt}"`;
  }

  prompt += `\n\nPlease provide the updated summary:`;

  // Generate unique userId for one-off summarization (messages won't be saved)
  const userId = `summarizer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const result = await summarizer.generateText(
    ctx,
    { userId },
    { prompt },
    { storageOptions: { saveMessages: 'none' } },
  );

  if (!result.text) {
    throw new Error(
      '[updateSummary] Summarizer returned empty text - no summary generated',
    );
  }

  return result.text;
}

/**
 * Configuration for context management
 */
export interface ContextConfig {
  /** Number of recent messages to keep in full (default: 20) */
  recentMessageCount: number;
  /** Threshold after which summarization kicks in (default: 40) */
  summarizationThreshold: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  recentMessageCount: 20,
  summarizationThreshold: 40,
};

/**
 * Split messages into those to summarize and those to keep in full.
 * Messages are expected to be in chronological order (oldest first).
 *
 * @param messages - All messages in the conversation
 * @param config - Context configuration
 * @returns Object with messagesToSummarize and recentMessages
 */
export function splitMessagesForContext<T extends MessageForSummary>(
  messages: T[],
  config: ContextConfig = DEFAULT_CONTEXT_CONFIG,
): {
  messagesToSummarize: T[];
  recentMessages: T[];
  needsSummarization: boolean;
} {
  const { recentMessageCount, summarizationThreshold } = config;

  // If under threshold, no summarization needed
  if (messages.length <= summarizationThreshold) {
    return {
      messagesToSummarize: [],
      recentMessages: messages,
      needsSummarization: false,
    };
  }

  // Split: older messages for summarization, recent messages kept in full
  const splitPoint = messages.length - recentMessageCount;
  const messagesToSummarize = messages.slice(0, splitPoint);
  const recentMessages = messages.slice(splitPoint);

  return {
    messagesToSummarize,
    recentMessages,
    needsSummarization: true,
  };
}
