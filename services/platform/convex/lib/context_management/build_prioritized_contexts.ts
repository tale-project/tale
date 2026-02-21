/**
 * Build Prioritized Contexts for Chat Agent
 *
 * Chat-agent-specific helper for building prioritized context array.
 * Uses the shared context management module under the hood.
 */

import {
  ContextPriority,
  createPrioritizedContext,
  type PrioritizedContext,
} from './context_priority';

/**
 * Build prioritized context array from various context sources.
 * This is the chat-agent-specific implementation that handles
 * the specific context types used by the main chat agent.
 */
export function buildPrioritizedContexts(params: {
  ragContext?: string;
}): PrioritizedContext[] {
  const contexts: PrioritizedContext[] = [];

  // Split RAG by relevance
  if (params.ragContext) {
    const { highRelevance, lowRelevance } = splitRagByRelevance(
      params.ragContext,
    );

    if (highRelevance) {
      contexts.push(
        createPrioritizedContext(
          'rag_high',
          ContextPriority.HIGH_RELEVANCE,
          `[KNOWLEDGE BASE] Highly relevant information:\n\n${highRelevance}`,
          { relevanceScore: 0.8, sectionName: 'knowledge_base_primary' },
        ),
      );
    }

    if (lowRelevance) {
      contexts.push(
        createPrioritizedContext(
          'rag_low',
          ContextPriority.LOW_RELEVANCE,
          `[KNOWLEDGE BASE] Related information:\n\n${lowRelevance}`,
          { relevanceScore: 0.5, sectionName: 'knowledge_base_secondary' },
        ),
      );
    }
  }

  return contexts;
}

/**
 * Split RAG results by relevance score into high and low priority.
 *
 * Expected input format: "[n] (Relevance: XX.X%)\ncontent\n\n---\n\n..."
 * This format is produced by the RAG query formatter upstream.
 */
function splitRagByRelevance(
  ragContext: string,
  highRelevanceThreshold = 0.7,
): { highRelevance: string | undefined; lowRelevance: string | undefined } {
  // Parse RAG results (format: [1] (Relevance: 85.0%)\ncontent\n\n---\n\n[2] ...)
  const resultPattern =
    /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)\n([\s\S]*?)(?=\n\n---\n\n|\n*$)/g;
  const highResults: string[] = [];
  const lowResults: string[] = [];

  let match;
  while ((match = resultPattern.exec(ragContext)) !== null) {
    const [fullMatch, , relevanceStr] = match;
    const relevance = parseFloat(relevanceStr) / 100;

    if (relevance >= highRelevanceThreshold) {
      highResults.push(fullMatch);
    } else {
      lowResults.push(fullMatch);
    }
  }

  return {
    highRelevance:
      highResults.length > 0 ? highResults.join('\n\n---\n\n') : undefined,
    lowRelevance:
      lowResults.length > 0 ? lowResults.join('\n\n---\n\n') : undefined,
  };
}
