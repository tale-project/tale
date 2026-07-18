import { describe, expect, it } from 'vitest';

import { DOCS_REPLIES, matchDocsReply } from './docs-replies';

describe('DOCS_REPLIES invariants', () => {
  it('match clauses are lowercase — matching lowercases the message, so a cased clause can never fire', () => {
    const cased = DOCS_REPLIES.filter(
      (reply) => reply.match !== reply.match.toLowerCase(),
    ).map((reply) => reply.match);
    expect(cased).toEqual([]);
  });

  it('match clauses are unique — a duplicate silently shadows its successor', () => {
    const seen = new Set<string>();
    const duplicates = DOCS_REPLIES.map((reply) => reply.match).filter(
      (match) => (seen.has(match) ? true : (seen.add(match), false)),
    );
    expect(duplicates).toEqual([]);
  });

  it('pausing tool turns carry intro content — an empty generation trips the model-fallback banner (#2767)', () => {
    const offenders = DOCS_REPLIES.filter(
      (reply) =>
        reply.tool?.name === 'request_human_input' && !reply.toolIntro?.trim(),
    ).map((reply) => reply.match);
    expect(offenders).toEqual([]);
  });

  it('matches case-insensitively and rides the tool along', () => {
    const matched = matchDocsReply(
      'What did customers say about ONBOARDING LAST QUARTER?',
    );
    expect(matched?.reply).toBeTruthy();
  });
});
