/**
 * Context Priority Management
 *
 * Manages context prioritization when approaching token limits.
 * Ensures critical information is preserved while trimming less important content.
 *
 * PRIORITY LEVELS (highest to lowest):
 * 1. System info - Always needed (thread ID)
 * 2. Current user message - The query being answered
 * 3. Recent conversation - Most recent exchanges
 * 4. Conversation summary - Compressed history
 * 5. High-relevance content - Score > 0.7
 * 6. Medium-relevance content - Integrations, metadata
 * 7. Low-relevance content - Score <= 0.7
 * 8. Dynamic info - Time-sensitive data (timestamps) placed last for cache optimization
 */

import { createDebugLog } from '../debug_log';
import { estimateTokens } from './estimate_tokens';

const debugLog = createDebugLog(
  'DEBUG_CONTEXT_MANAGEMENT',
  '[ContextPriority]',
);

/**
 * Priority levels for different context types.
 * Lower number = higher priority (will be kept when trimming).
 */
export enum ContextPriority {
  SYSTEM_INFO = 1,
  CURRENT_USER_MESSAGE = 2,
  RECENT_CONVERSATION = 3,
  CONVERSATION_SUMMARY = 4,
  HIGH_RELEVANCE = 5,
  MEDIUM_RELEVANCE = 6,
  LOW_RELEVANCE = 7,
  /** Dynamic info (timestamps, etc.) - placed last to improve LLM cache hit rate */
  DYNAMIC_INFO = 8,
}

/**
 * A piece of context with its priority and token cost.
 */
export interface PrioritizedContext {
  /** Unique identifier for this context piece */
  id: string;
  /** The priority level */
  priority: ContextPriority;
  /** The actual content */
  content: string;
  /** Estimated token count */
  tokens: number;
  /** Whether this context can be trimmed (some are mandatory) */
  canTrim: boolean;
  /** Optional: relevance score for ranked results */
  relevanceScore?: number;
  /** Optional: section name for XML output */
  sectionName?: string;
}

/**
 * Result of context trimming operation.
 */
export interface TrimResult {
  /** Contexts that were kept */
  kept: PrioritizedContext[];
  /** Contexts that were trimmed */
  trimmed: PrioritizedContext[];
  /** Total tokens in kept contexts */
  totalTokens: number;
  /** Whether any trimming occurred */
  wasTrimmed: boolean;
}

/**
 * Create a prioritized context item.
 */
export function createPrioritizedContext(
  id: string,
  priority: ContextPriority,
  content: string,
  options?: {
    canTrim?: boolean;
    relevanceScore?: number;
    sectionName?: string;
  },
): PrioritizedContext {
  return {
    id,
    priority,
    content,
    tokens: estimateTokens(content),
    canTrim: options?.canTrim ?? true,
    relevanceScore: options?.relevanceScore,
    sectionName: options?.sectionName,
  };
}

/**
 * Trim contexts to fit within a token budget.
 * Removes lowest priority items first until under budget.
 *
 * @param contexts - Array of prioritized contexts
 * @param tokenBudget - Maximum tokens allowed
 * @returns TrimResult with kept and trimmed contexts
 */
export function trimContextsByPriority(
  contexts: PrioritizedContext[],
  tokenBudget: number,
): TrimResult {
  // Sort by priority (lower number = higher priority = keep first)
  // For same priority, sort by relevance score (higher = keep first)
  const sorted = [...contexts].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Same priority: prefer higher relevance score
    const scoreA = a.relevanceScore ?? 0;
    const scoreB = b.relevanceScore ?? 0;
    return scoreB - scoreA;
  });

  const kept: PrioritizedContext[] = [];
  const trimmed: PrioritizedContext[] = [];
  let totalTokens = 0;
  let warnedMandatoryOverBudget = false;

  for (const ctx of sorted) {
    // Mandatory contexts are always kept
    if (!ctx.canTrim) {
      kept.push(ctx);
      totalTokens += ctx.tokens;

      // Warn once if mandatory items alone exceed budget
      if (!warnedMandatoryOverBudget && totalTokens > tokenBudget) {
        debugLog('Warning: Mandatory items exceed token budget', {
          mandatoryTokens: totalTokens,
          tokenBudget,
          lastMandatoryItem: ctx.id,
        });
        warnedMandatoryOverBudget = true;
      }
      continue;
    }

    // Check if we have room
    if (totalTokens + ctx.tokens <= tokenBudget) {
      kept.push(ctx);
      totalTokens += ctx.tokens;
    } else {
      trimmed.push(ctx);
    }
  }

  const wasTrimmed = trimmed.length > 0;

  if (wasTrimmed) {
    debugLog('Context trimmed due to token budget', {
      tokenBudget,
      totalTokensKept: totalTokens,
      keptCount: kept.length,
      trimmedCount: trimmed.length,
      trimmedIds: trimmed.map((t) => t.id),
    });
  }

  return {
    kept,
    trimmed,
    totalTokens,
    wasTrimmed,
  };
}

/**
 * Convert prioritized contexts to a single merged system message.
 *
 * Benefits:
 * - Reduces token overhead from multiple message boundaries
 * - Uses XML-like structure for clear section delineation
 * - LLMs understand structured formats well
 */
export function prioritizedContextsToMessage(
  contexts: PrioritizedContext[],
): { role: 'system'; content: string } | null {
  if (contexts.length === 0) {
    return null;
  }

  // Sort by priority to ensure consistent ordering
  const sorted = [...contexts].sort((a, b) => a.priority - b.priority);

  // Build sections with XML-like structure
  const sections: string[] = [];

  for (const ctx of sorted) {
    const sectionName = ctx.sectionName || ctx.id;
    sections.push(`<${sectionName}>\n${ctx.content}\n</${sectionName}>`);
  }

  // Combine all sections into a single structured message
  const mergedContent = `<system_context>\n${sections.join('\n\n')}\n</system_context>`;

  return {
    role: 'system' as const,
    content: mergedContent,
  };
}

/**
 * Convert prioritized contexts to an array of system messages.
 * Backward compatible with existing code that expects an array.
 */
export function prioritizedContextsToMessages(
  contexts: PrioritizedContext[],
): Array<{ role: 'system'; content: string }> {
  const message = prioritizedContextsToMessage(contexts);
  return message ? [message] : [];
}
