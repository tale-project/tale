/**
 * Context Summarization for Long Conversations
 *
 * CHUNKED INCREMENTAL SUMMARIZATION:
 * - Never truncates content - all information is preserved
 * - If total tokens exceed limit, summarizes in chunks based on token count
 * - Each chunk builds on the previous summary (rolling/hierarchical)
 * - Example: 100K tokens → multiple iterations until all processed
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';

import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { ResolvedModelData } from '../providers/resolve_model';
import { createDebugLog } from './debug_log';
import { renderPrompt } from './prompts/registry';
import { buildCallProviderOptions } from './provider_options';

const debugLog = createDebugLog('DEBUG_CONTEXT_SUMMARY', '[ContextSummary]');

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

const SUMMARIZATION_INSTRUCTIONS = renderPrompt('summarization.full');

const INCREMENTAL_SUMMARIZATION_INSTRUCTIONS = renderPrompt(
  'summarization.incremental',
);

/**
 * Create a lightweight summarizer agent (no tools, just for summarization).
 * Caller passes `providerOptions` per-call into `summarizer.generateText({...})`
 * — Agent-level providerOptions is `@deprecated`.
 */
function createSummarizerAgent(
  languageModel: LanguageModelV3,
  incremental: boolean = false,
): Agent {
  return new Agent(components.agent, {
    name: 'summarizer',
    languageModel,
    instructions: incremental
      ? INCREMENTAL_SUMMARIZATION_INSTRUCTIONS
      : SUMMARIZATION_INSTRUCTIONS,
    // Cap output to ensure the model has room to respond without OpenRouter
    // defaulting to a low limit and truncating mid-summary.
    callSettings: { maxOutputTokens: 8192 },
  });
}

/**
 * Run a summarizer agent on a prompt and return its text, throwing if empty.
 * Messages are never persisted (`saveMessages: 'none'`), so a fresh one-off
 * userId is generated per call.
 */
async function runSummarizer(
  ctx: ActionCtx,
  summarizer: Agent,
  prompt: string,
  modelData: ResolvedModelData | undefined,
  errorLabel: string,
): Promise<string> {
  const callProviderOptions = modelData
    ? buildCallProviderOptions(modelData)
    : undefined;
  const userId = `summarizer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const result = await summarizer.generateText(
    ctx,
    { userId },
    {
      prompt,
      ...(callProviderOptions ? { providerOptions: callProviderOptions } : {}),
    },
    { storageOptions: { saveMessages: 'none' } },
  );

  if (!result.text) {
    throw new Error(
      `${errorLabel} Summarizer returned empty text - no summary generated`,
    );
  }

  return result.text;
}

/**
 * Format messages for summarization - NO truncation, preserves all content.
 */
function formatMessagesForSummary(messages: MessageForSummary[]): string {
  return messages
    .map((m) =>
      m.role === 'tool' && m.toolName
        ? `TOOL RESULT (${m.toolName}): ${m.content}`
        : `${m.role.toUpperCase()}: ${m.content}`,
    )
    .join('\n\n');
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

    // A single oversized message gets its own chunk (after flushing any pending).
    if (messageTokens >= MAX_CHUNK_TOKENS) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      chunks.push([message]);
      continue;
    }

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
  currentPrompt: string | undefined,
  languageModel: LanguageModelV3,
  modelData?: ResolvedModelData,
): Promise<string> {
  if (messages.length === 0) {
    debugLog('summarizeMessages No messages to summarize');
    return '';
  }

  const chunks = splitIntoTokenChunks(messages);

  if (chunks.length === 1) {
    return await summarizeSingleChunk(
      ctx,
      chunks[0],
      currentPrompt,
      languageModel,
      modelData,
    );
  }

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
      rollingSummary = await summarizeSingleChunk(
        ctx,
        chunk,
        currentPrompt,
        languageModel,
        modelData,
      );
    } else {
      rollingSummary = await updateSummary(
        ctx,
        rollingSummary,
        chunk,
        currentPrompt,
        languageModel,
        modelData,
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
  currentPrompt: string | undefined,
  languageModel: LanguageModelV3,
  modelData: ResolvedModelData | undefined,
): Promise<string> {
  const formattedMessages = formatMessagesForSummary(messages);
  debugLog(
    `summarizeSingleChunk Formatted ${messages.length} messages, total chars: ${formattedMessages.length}`,
  );

  const summarizer = createSummarizerAgent(languageModel, false);

  const prompt = currentPrompt
    ? `The user is now asking: "${currentPrompt}"

Summarize the following conversation history, prioritizing information relevant to the user's current question:

${formattedMessages}`
    : `Summarize this conversation:\n\n${formattedMessages}`;

  return runSummarizer(
    ctx,
    summarizer,
    prompt,
    modelData,
    '[summarizeSingleChunk]',
  );
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
  currentPrompt: string | undefined,
  languageModel: LanguageModelV3,
  modelData?: ResolvedModelData,
): Promise<string> {
  if (newMessages.length === 0) {
    return existingSummary;
  }

  const formattedNewMessages = formatMessagesForSummary(newMessages);
  const summarizer = createSummarizerAgent(languageModel, true);

  let prompt = `## Existing Summary

${existingSummary}

## New Messages to Incorporate

${formattedNewMessages}`;

  if (currentPrompt) {
    prompt += `\n\n## Current User Question (for context)\n\n"${currentPrompt}"`;
  }

  prompt += `\n\nPlease provide the updated summary:`;

  return runSummarizer(ctx, summarizer, prompt, modelData, '[updateSummary]');
}
