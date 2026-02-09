/**
 * Token Estimation Utilities
 *
 * Provides rough token count estimates for context budgeting.
 * These are approximations - actual tokenization varies by model.
 *
 * IMPROVEMENTS (P0):
 * 1. CJK-aware estimation - Chinese/Japanese/Korean use ~1.5-2 chars per token
 * 2. Accurate tool message estimation - serialize and count actual content
 * 3. JSON structure overhead - account for serialization
 */

import type { ModelMessage } from '@ai-sdk/provider-utils';

/**
 * Approximate characters per token for different content types.
 * - English/Latin text: ~4 chars/token
 * - CJK characters: ~1.5 chars/token (each character often becomes 1-2 tokens)
 * - JSON/code: ~3 chars/token (structure overhead)
 */
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CJK = 1.5;
const CHARS_PER_TOKEN_JSON = 3;

/**
 * Base overhead for message structure (role, formatting).
 */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Regex to match CJK characters (Chinese, Japanese, Korean).
 * Includes:
 * - CJK Unified Ideographs
 * - CJK Unified Ideographs Extension A-F
 * - Hiragana, Katakana
 * - Hangul
 */
const CJK_PATTERN =
  /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/**
 * Estimate token count for a string with CJK awareness.
 * This provides more accurate estimates for multilingual content.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count CJK characters
  const cjkMatches = text.match(CJK_PATTERN);
  const cjkCharCount = cjkMatches ? cjkMatches.length : 0;
  const latinCharCount = text.length - cjkCharCount;

  // Calculate tokens for each character type
  const cjkTokens = Math.ceil(cjkCharCount / CHARS_PER_TOKEN_CJK);
  const latinTokens = Math.ceil(latinCharCount / CHARS_PER_TOKEN_LATIN);

  return cjkTokens + latinTokens;
}

/**
 * Estimate token count for JSON content.
 * JSON has more structural overhead than plain text.
 */
export function estimateJsonTokens(obj: unknown): number {
  try {
    const jsonStr = JSON.stringify(obj);
    // JSON uses ~3 chars per token due to structure
    return Math.ceil(jsonStr.length / CHARS_PER_TOKEN_JSON);
  } catch {
    return 100; // Fallback for circular references or other issues
  }
}

/**
 * Estimate token count for a ModelMessage.
 * Properly handles all content types including tool calls and results.
 */
export function estimateMessageTokens(message: ModelMessage): number {
  const content = message.content;
  let tokens = MESSAGE_OVERHEAD_TOKENS; // Base overhead for role, etc.

  if (typeof content === 'string') {
    tokens += estimateTokens(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        tokens += estimateTokens(part);
      } else if (part && typeof part === 'object') {
        // Text part
        if ('text' in part && typeof part.text === 'string') {
          tokens += estimateTokens(part.text);
        }
        // Tool call - count tool name + serialized args
        else if ('type' in part && part.type === 'tool-call') {
          const toolPart = part as { toolName?: string; args?: unknown };
          tokens += 10; // Tool call structure overhead
          tokens += estimateTokens(toolPart.toolName || '');
          if (toolPart.args) {
            tokens += estimateJsonTokens(toolPart.args);
          }
        }
        // Tool result - count tool name + serialized result
        else if ('type' in part && part.type === 'tool-result') {
          const resultPart = part as { toolName?: string; result?: unknown };
          tokens += 10; // Tool result structure overhead
          tokens += estimateTokens(resultPart.toolName || '');
          if (resultPart.result) {
            tokens += estimateJsonTokens(resultPart.result);
          }
        }
        // Image - significant token cost
        else if ('type' in part && part.type === 'image') {
          tokens += 500; // Images typically cost 500-1000 tokens
        }
        // Unknown part type - serialize and estimate
        else {
          tokens += estimateJsonTokens(part);
        }
      }
    }
  } else if (content && typeof content === 'object') {
    tokens += estimateJsonTokens(content);
  }

  return tokens;
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Estimate tokens for a MessageDoc from the agent component.
 * This handles the nested message structure from @convex-dev/agent.
 */
export function estimateMessageDocTokens(messageDoc: {
  message?: { role?: string; content?: unknown };
}): number {
  if (!messageDoc.message?.content) {
    return MESSAGE_OVERHEAD_TOKENS;
  }

  const content = messageDoc.message.content;
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  if (typeof content === 'string') {
    tokens += estimateTokens(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        tokens += estimateTokens(part);
      } else if (part && typeof part === 'object') {
        if ('text' in part && typeof part.text === 'string') {
          tokens += estimateTokens(part.text);
        } else if ('type' in part && part.type === 'tool-result') {
          // Tool results can be large - properly serialize
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
          const resultPart = part as { toolName?: string; result?: unknown };
          tokens += 10;
          tokens += estimateTokens(resultPart.toolName || '');
          if (resultPart.result) {
            tokens += estimateJsonTokens(resultPart.result);
          }
        } else {
          // Unknown part - serialize
          tokens += estimateJsonTokens(part);
        }
      }
    }
  } else {
    tokens += estimateJsonTokens(content);
  }

  return tokens;
}
