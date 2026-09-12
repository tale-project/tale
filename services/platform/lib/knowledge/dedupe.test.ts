import { describe, expect, it } from 'vitest';

import { dropRepeatedPassages } from './dedupe';
import type { KnowledgeHit } from './types';

function hit(
  corpus: 'documents' | 'web',
  ref: string,
  text: string,
): KnowledgeHit {
  return {
    id: `${corpus}:${ref}:${text}`,
    corpus,
    text,
    chunkIndex: 0,
    source: { ref, title: ref, url: corpus === 'web' ? ref : null },
    score: 1,
  };
}

describe('dropRepeatedPassages — the same passage twice', () => {
  it('returns one copy, keeping the first (best-scoring) ref', () => {
    // A bounded result set spending two slots on one passage pushes a
    // different answer off the end.
    const kept = dropRepeatedPassages([
      hit('documents', 'copy_a', 'Refunds within 30 days.'),
      hit('documents', 'copy_b', 'Refunds within 30 days.'),
    ]);
    expect(kept.map((entry) => entry.source.ref)).toEqual(['copy_a']);
  });

  it('keeps a distinct passage from the same document', () => {
    // Deduping is per passage, not per document — a second chunk of the same
    // file is a different answer.
    const kept = dropRepeatedPassages([
      hit('documents', 'doc', 'First passage.'),
      hit('documents', 'doc', 'Second passage.'),
    ]);
    expect(kept.map((entry) => entry.text)).toEqual([
      'First passage.',
      'Second passage.',
    ]);
  });

  it('treats two copies that only wrap differently as one', () => {
    expect(
      dropRepeatedPassages([
        hit(
          'documents',
          'copy_a',
          'Refunds within' + String.fromCharCode(10) + '30 days.',
        ),
        hit('documents', 'copy_b', 'Refunds within 30 days.'),
      ]),
    ).toHaveLength(1);
  });

  it('does not collapse the same text across different corpora', () => {
    expect(
      dropRepeatedPassages([
        hit('documents', 'doc', 'Shared wording.'),
        hit('web', 'https://example.com', 'Shared wording.'),
      ]),
    ).toHaveLength(2);
  });
});
