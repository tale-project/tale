/** Maximum length of a knowledge entry topic (characters). */
export const TOPIC_MAX_LENGTH = 120;

/** Maximum length of a knowledge entry's markdown content (characters). */
export const CONTENT_MAX_LENGTH = 8000;

/** `documents.sourceProvider` value for knowledge-entry backing documents. */
export const KNOWLEDGE_SOURCE_PROVIDER = 'knowledge';

/**
 * Normalize a topic into the dedup key used for topic-keyed upsert:
 * trim, collapse internal whitespace, lowercase. V1 duplicate detection —
 * embedding-similarity dedup across differently-worded topics is an
 * explicit follow-up.
 */
export function normalizeTopicKey(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ').toLowerCase();
}
