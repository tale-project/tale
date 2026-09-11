// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { withDocumentIds } from './service.ts';

/**
 * A search hit names its chunk by BLOB reference — the corpus key — which no
 * document route takes. The org search stamps the document id the caller can
 * open, cite or delete, resolved in the hit's own project scope.
 */
function fakeSql(
  rows: { id: string; fileRef: string; projectId: string | null }[],
) {
  const queries: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({
      text: strings.join('$?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, queries };
}

const hit = (ref: string, projectId: string | null, corpus = 'documents') => ({
  id: `${corpus}:${ref}`,
  corpus,
  text: 'chunk',
  source: { ref, title: 'Ledger', projectId },
  chunkIndex: 0,
  score: 1,
});

describe('withDocumentIds', () => {
  it('stamps the active document that exposes the ref in the hit’s project scope', async () => {
    const { sql, queries } = fakeSql([
      { id: 'doc-newest', fileRef: 'acme/blob-1', projectId: 'p-1' },
      { id: 'doc-older', fileRef: 'acme/blob-1', projectId: 'p-1' },
      { id: 'doc-hub', fileRef: 'acme/blob-1', projectId: null },
    ]);
    const hits = await withDocumentIds(sql, 'org-1', [
      hit('acme/blob-1', 'p-1'),
      hit('acme/blob-1', null),
      hit('https://example.test/page', null, 'web'),
    ]);
    expect(hits.map((entry) => entry.source)).toEqual([
      {
        ref: 'acme/blob-1',
        title: 'Ledger',
        projectId: 'p-1',
        documentId: 'doc-newest',
      },
      {
        ref: 'acme/blob-1',
        title: 'Ledger',
        projectId: null,
        documentId: 'doc-hub',
      },
      { ref: 'https://example.test/page', title: 'Ledger', projectId: null },
    ]);
    // One read for the page, scoped to the org and the document refs only.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('FROM app.documents');
    expect(queries[0]?.values).toEqual(['org-1', ['acme/blob-1']]);
  });

  it('leaves a hit whose ref no active document holds untouched, and reads nothing for a web-only page', async () => {
    const unheld = fakeSql([]);
    const [orphan] = await withDocumentIds(unheld.sql, 'org-1', [
      hit('acme/thread-upload', null),
    ]);
    expect(orphan?.source).not.toHaveProperty('documentId');

    const web = fakeSql([]);
    await withDocumentIds(web.sql, 'org-1', [
      hit('https://example.test/page', null, 'web'),
    ]);
    expect(web.queries).toHaveLength(0);
  });
});
