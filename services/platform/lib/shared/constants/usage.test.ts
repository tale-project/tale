import { describe, expect, it } from 'vitest';

import {
  bucketAgentSlug,
  EMBEDDING_SLUG,
  isEmbeddingSlug,
  isSyntheticAgentSlug,
} from './usage';

/**
 * The embedding requests knowledge indexing and every knowledge search make
 * are booked under their own sentinel: one row of their own under Top
 * assistants, never folded into an assistant's, and never a drill-down into
 * an agent that does not exist.
 */
describe('the embedding sentinel', () => {
  it('buckets an embedding row under its own slug', () => {
    expect(
      bucketAgentSlug({
        agentSlug: EMBEDDING_SLUG,
        model: 'text-embedding-3-small',
        provider: 'openai',
      }),
    ).toBe('__embedding__');
  });

  it('is a synthetic slug, not an agent', () => {
    expect(isEmbeddingSlug('__embedding__')).toBe(true);
    expect(isSyntheticAgentSlug('__embedding__')).toBe(true);
    expect(isEmbeddingSlug('support-agent')).toBe(false);
  });
});
