import { describe, expect, it } from 'vitest';

import { authorizeRls } from './access.ts';

/**
 * The `knowledge` subject: knowledge entries materialize documents rows and
 * feed the RAG corpus, so their write grant mirrors `documents` — editor
 * and up write, member reads, disabled nothing.
 */
describe('authorizeRls knowledge subject', () => {
  it('grants write to owner/admin/developer/editor', () => {
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      expect(authorizeRls(role, 'knowledge', 'read')).toBe(true);
      expect(authorizeRls(role, 'knowledge', 'write')).toBe(true);
    }
  });

  it('keeps member read-only and disabled shut out', () => {
    expect(authorizeRls('member', 'knowledge', 'read')).toBe(true);
    expect(authorizeRls('member', 'knowledge', 'write')).toBe(false);
    expect(authorizeRls('disabled', 'knowledge', 'read')).toBe(false);
    expect(authorizeRls('disabled', 'knowledge', 'write')).toBe(false);
  });

  it('degrades unknown or missing roles to member', () => {
    expect(authorizeRls(undefined, 'knowledge', 'write')).toBe(false);
    expect(authorizeRls('intruder', 'knowledge', 'write')).toBe(false);
    expect(authorizeRls('intruder', 'knowledge', 'read')).toBe(true);
  });
});
