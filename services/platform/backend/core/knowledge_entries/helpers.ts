/**
 * Pure validation for knowledge entries — the one piece of the 0.4 module
 * the 0.5 service (`domains/knowledge_entries/service.ts`) still reuses.
 * The Convex-era row helpers (topic-keyed upsert, chain soft-delete) had no
 * database handle to run against in 0.5 and are gone; the supersede chain
 * and the document-delete hook (`markEntryChainDeletedForDocument`) live in
 * the service itself.
 */

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
  normalizeTopicKey,
} from './constants';

export function validateTopicAndContent(
  topic: string,
  content: string,
): { topic: string; topicKey: string; content: string } {
  const trimmedTopic = topic.trim();
  const trimmedContent = content.trim();
  // Structured AppError codes so the client surfaces a readable message
  // instead of an opaque "Server Error" (raw `Error` messages are redacted by
  // Convex in prod). Called from both public and internal mutations;
  // AppError propagates correctly through both paths.
  if (!trimmedTopic) {
    throw new AppError({ code: 'KNOWLEDGE_ENTRY_TOPIC_REQUIRED' });
  }
  if (trimmedTopic.length > TOPIC_MAX_LENGTH) {
    throw new AppError({
      code: 'KNOWLEDGE_ENTRY_TOPIC_TOO_LONG',
      max: TOPIC_MAX_LENGTH,
    });
  }
  if (!trimmedContent) {
    throw new AppError({ code: 'KNOWLEDGE_ENTRY_CONTENT_REQUIRED' });
  }
  if (trimmedContent.length > CONTENT_MAX_LENGTH) {
    throw new AppError({
      code: 'KNOWLEDGE_ENTRY_CONTENT_TOO_LONG',
      max: CONTENT_MAX_LENGTH,
    });
  }
  return {
    topic: trimmedTopic,
    topicKey: normalizeTopicKey(trimmedTopic),
    content: trimmedContent,
  };
}
