import type { SearchStrategy } from '../types';

/**
 * Knowledge entries, for WORD matching only.
 *
 * `topic` is the prose; `topicKey` is its slug, matched as an id so an exact
 * key still wins. `content` is deliberately absent — the agent listing filters
 * on the topic alone, and matching whole bodies here would turn a topic filter
 * into a full-text search over every entry.
 */
export const knowledgeEntriesSearchStrategy: SearchStrategy<'knowledgeEntries'> =
  {
    table: 'knowledgeEntries',
    orgIndex: 'by_organizationId_and_status',
    textFields: ['topic'],
    idFields: ['topicKey'],
    engine: 'scan',
  };
