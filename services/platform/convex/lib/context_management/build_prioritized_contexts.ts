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
  threadId: string;
  contextSummary?: string;
  ragContext?: string;
  integrationsInfo?: string;
}): PrioritizedContext[] {
  const contexts: PrioritizedContext[] = [];

  // System info is mandatory and highest priority (thread ID only - static)
  contexts.push(
    createPrioritizedContext(
      'system_info',
      ContextPriority.SYSTEM_INFO,
      `[SYSTEM] Current thread ID: ${params.threadId}`,
      { canTrim: false, sectionName: 'system_info' },
    ),
  );

  // Current time is placed last (DYNAMIC_INFO) to improve LLM cache hit rate
  contexts.push(
    createPrioritizedContext(
      'current_time',
      ContextPriority.DYNAMIC_INFO,
      `[TIME] Current time: ${new Date().toISOString()}`,
      { canTrim: false, sectionName: 'current_time' },
    ),
  );

  // Conversation summary
  if (params.contextSummary) {
    contexts.push(
      createPrioritizedContext(
        'context_summary',
        ContextPriority.CONVERSATION_SUMMARY,
        `[CONTEXT] Previous Conversation Summary:\n\n${params.contextSummary}`,
        { sectionName: 'conversation_summary' },
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

  // Integrations info with routing guidance
  if (params.integrationsInfo) {
    contexts.push(
      createPrioritizedContext(
        'integrations',
        ContextPriority.MEDIUM_RELEVANCE,
        `[INTEGRATIONS] Available external integrations:

${params.integrationsInfo}

ROUTING GUIDANCE:
• Data from external systems (hotels, e-commerce, etc.) is ONLY accessible via integration_assistant
• customer_read and product_read ONLY access internal CRM/catalog data
• If a query relates to any integration domain above, use integration_assistant
• Use integration_introspect to discover available operations before calling integration`,
        { sectionName: 'integrations' },
      ),
    );
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
  const resultPattern = /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)\n([\s\S]*?)(?=\n\n---\n\n|\n*$)/g;
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
    highRelevance: highResults.length > 0 ? highResults.join('\n\n---\n\n') : undefined,
    lowRelevance: lowResults.length > 0 ? lowResults.join('\n\n---\n\n') : undefined,
  };
}
