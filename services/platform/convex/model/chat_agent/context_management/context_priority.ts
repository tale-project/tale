/**
 * Context Priority Management (P1)
 *
 * Manages context prioritization when approaching token limits.
 * Ensures critical information is preserved while trimming less important content.
 *
 * PRIORITY LEVELS (highest to lowest):
 * 1. Thread ID - Always needed for tool context
 * 2. Current user message - The query being answered
 * 3. Recent conversation - Most recent exchanges
 * 4. Conversation summary - Compressed history
 * 5. High-relevance RAG - Score > 0.7
 * 6. Integrations info - Available external systems
 * 7. Low-relevance RAG - Score <= 0.7
 */

import { estimateTokens } from './estimate_tokens';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ContextPriority]');

/**
 * Priority levels for different context types.
 * Lower number = higher priority (will be kept when trimming).
 */
export enum ContextPriority {
  THREAD_ID = 1,
  CURRENT_USER_MESSAGE = 2,
  RECENT_CONVERSATION = 3,
  CONVERSATION_SUMMARY = 4,
  HIGH_RELEVANCE_RAG = 5,
  INTEGRATIONS = 6,
  LOW_RELEVANCE_RAG = 7,
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
  /** Optional: relevance score for RAG results */
  relevanceScore?: number;
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
  },
): PrioritizedContext {
  return {
    id,
    priority,
    content,
    tokens: estimateTokens(content),
    canTrim: options?.canTrim ?? true,
    relevanceScore: options?.relevanceScore,
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

  for (const ctx of sorted) {
    // Mandatory contexts are always kept
    if (!ctx.canTrim) {
      kept.push(ctx);
      totalTokens += ctx.tokens;
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
 * Split RAG results by relevance score into high and low priority.
 */
export function splitRagByRelevance(
  ragContext: string | undefined,
  highRelevanceThreshold: number = 0.7,
): { highRelevance: string | undefined; lowRelevance: string | undefined } {
  if (!ragContext) {
    return { highRelevance: undefined, lowRelevance: undefined };
  }

  // Parse RAG results (format: [1] (Relevance: 85.0%)\ncontent\n\n---\n\n[2] ...)
  const resultPattern = /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)\n([\s\S]*?)(?=\n\n---\n\n|\n*$)/g;
  const highResults: string[] = [];
  const lowResults: string[] = [];

  let match;
  while ((match = resultPattern.exec(ragContext)) !== null) {
    const [fullMatch, _index, relevanceStr, content] = match;
    const relevance = parseFloat(relevanceStr) / 100;

    if (relevance >= highRelevanceThreshold) {
      highResults.push(fullMatch);
    } else {
      lowResults.push(fullMatch);
    }
  }

  return {
    highRelevance: highResults.length > 0 ? highResults.join('\n\n---\n\n') : undefined,
    lowRelevance: lowResults.length > 0 ? lowResults.join('\n\n---\n\n') : undefined,
  };
}

/**
 * Build prioritized context array from various context sources.
 */
export function buildPrioritizedContexts(params: {
  threadId: string;
  contextSummary?: string;
  ragContext?: string;
  integrationsInfo?: string;
}): PrioritizedContext[] {
  const contexts: PrioritizedContext[] = [];

  // System info is mandatory and highest priority (thread ID + current time)
  contexts.push(
    createPrioritizedContext(
      'system_info',
      ContextPriority.THREAD_ID,
      `[SYSTEM] Current thread ID: ${params.threadId}\nCurrent time: ${new Date().toISOString()}`,
      { canTrim: false },
    ),
  );

  // Conversation summary
  if (params.contextSummary) {
    contexts.push(
      createPrioritizedContext(
        'context_summary',
        ContextPriority.CONVERSATION_SUMMARY,
        `[CONTEXT] Previous Conversation Summary:\n\n${params.contextSummary}`,
      ),
    );
  }

  // Split RAG by relevance
  if (params.ragContext) {
    const { highRelevance, lowRelevance } = splitRagByRelevance(params.ragContext);

    if (highRelevance) {
      contexts.push(
        createPrioritizedContext(
          'rag_high',
          ContextPriority.HIGH_RELEVANCE_RAG,
          `[KNOWLEDGE BASE] Highly relevant information:\n\n${highRelevance}`,
          { relevanceScore: 0.8 },
        ),
      );
    }

    if (lowRelevance) {
      contexts.push(
        createPrioritizedContext(
          'rag_low',
          ContextPriority.LOW_RELEVANCE_RAG,
          `[KNOWLEDGE BASE] Related information:\n\n${lowRelevance}`,
          { relevanceScore: 0.5 },
        ),
      );
    }
  }

  // Integrations info
  if (params.integrationsInfo) {
    contexts.push(
      createPrioritizedContext(
        'integrations',
        ContextPriority.INTEGRATIONS,
        `[INTEGRATIONS] Available external integrations:\n\n${params.integrationsInfo}\n\nUse integration_introspect tool with the integration name to see available operations, then use the integration tool to execute operations.`,
      ),
    );
  }

  return contexts;
}

/**
 * Convert prioritized contexts to a single merged system message (P2 optimization).
 *
 * Benefits:
 * - Reduces token overhead from multiple message boundaries
 * - Uses XML-like structure for clear section delineation
 * - LLMs understand structured formats well
 */
export function prioritizedContextsToMessages(
  contexts: PrioritizedContext[],
): Array<{ role: 'system'; content: string }> {
  if (contexts.length === 0) {
    return [];
  }

  // Sort by priority to ensure consistent ordering
  const sorted = [...contexts].sort((a, b) => a.priority - b.priority);

  // Extract content without the [TAG] prefixes and organize into sections
  const sections: string[] = [];

  for (const ctx of sorted) {
    // Remove the [TAG] prefix and add to sections
    // Format: [TAG] Content -> just Content in the appropriate section
    const content = ctx.content;

    // Map context IDs to section names
    let sectionName: string;
    let sectionContent: string;

    if (ctx.id === 'system_info') {
      // Extract system info (thread ID + current time) from "[SYSTEM] ..."
      sectionName = 'system_info';
      sectionContent = content.replace(/^\[SYSTEM\]\s*/i, '').trim();
    } else if (ctx.id === 'context_summary') {
      sectionName = 'conversation_summary';
      sectionContent = content.replace(/^\[CONTEXT\]\s*Previous Conversation Summary:\s*/i, '').trim();
    } else if (ctx.id === 'rag_high') {
      sectionName = 'knowledge_base_primary';
      sectionContent = content.replace(/^\[KNOWLEDGE BASE\]\s*Highly relevant information:\s*/i, '').trim();
    } else if (ctx.id === 'rag_low') {
      sectionName = 'knowledge_base_secondary';
      sectionContent = content.replace(/^\[KNOWLEDGE BASE\]\s*Related information:\s*/i, '').trim();
    } else if (ctx.id === 'integrations') {
      sectionName = 'integrations';
      // Keep the instruction about how to use integrations
      sectionContent = content.replace(/^\[INTEGRATIONS\]\s*Available external integrations:\s*/i, '').trim();
    } else {
      // Unknown context type - use as-is
      sectionName = ctx.id;
      sectionContent = content;
    }

    sections.push(`<${sectionName}>\n${sectionContent}\n</${sectionName}>`);
  }

  // Combine all sections into a single structured message
  const mergedContent = `<system_context>
${sections.join('\n\n')}
</system_context>`;

  return [
    {
      role: 'system' as const,
      content: mergedContent,
    },
  ];
}
