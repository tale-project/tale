// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { DocumentCorpusReader, WebCorpusReader } from './corpus';
import { markBm25Unavailable } from './pool';

/**
 * These readers are the last place an organization boundary could be lost, so
 * the tests read the statements they issue and check the scoping directly.
 *
 * The double is a recorder, not a database: what is being tested is which SQL
 * is sent and with which parameters. A live ParadeDB would make the tenant
 * assertions weaker, not stronger — it would prove one query returned the right
 * rows, whereas reading the statement proves every query is scoped.
 */

interface Recorded {
  readonly text: string;
  readonly params: readonly unknown[];
}

function recorder(rows: unknown[] = []): {
  sql: Sql;
  sent: Recorded[];
} {
  const sent: Recorded[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    // The BM25 capability probe uses tagged-template form.
    sent.push({ text: strings.join('?'), params: [] });
    return Promise.resolve([{ '?column?': 1 }]);
  }) as unknown as Sql & { unsafe: unknown };
  sql.unsafe = ((text: string, params: unknown[] = []) => {
    sent.push({ text, params });
    return Promise.resolve(rows);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- postgres.js types `unsafe` as returning a rich PendingQuery; the readers only await it, so a promise of rows is all the double has to be
  }) as unknown as Sql['unsafe'];
  return { sql: sql as Sql, sent };
}

const LEG = { query: 'parental leave', limit: 30 };
const EMBEDDING = [0.1, 0.2, 0.3];

/** Statements that actually query the corpus — the capability probe is not
 * one, and would otherwise dilute the "every statement is scoped" assertions. */
function corpusStatements(sent: readonly Recorded[]): Recorded[] {
  return sent.filter((entry) => entry.text.includes('.chunks'));
}

describe('the documents corpus is scoped to one organization', () => {
  it('filters both legs by the organization it was constructed for', async () => {
    const { sql, sent } = recorder();
    const reader = new DocumentCorpusReader(sql, 'acme');
    await reader.keyword(LEG);
    await reader.dense({ ...LEG, embedding: EMBEDDING });

    const statements = corpusStatements(sent);
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      expect(statement.text).toContain('c.org_slug = $2');
      expect(statement.params).toContain('acme');
    }
  });

  it('joins chunks to documents on the organization as well as the id', async () => {
    // The composite join is what stops a chunk of one organization from being
    // attributed to another organization's document.
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    expect(corpusStatements(sent)[0].text).toContain(
      'd.id = c.document_id AND d.org_slug = c.org_slug',
    );
  });

  it('takes the organization from its constructor, never from the query', async () => {
    // A second organization asking the same question addresses its own corpus,
    // and nothing in the query could change that.
    const acme = recorder();
    const globex = recorder();
    await new DocumentCorpusReader(acme.sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    await new DocumentCorpusReader(globex.sql, 'globex').dense({
      ...LEG,
      embedding: EMBEDDING,
    });

    expect(corpusStatements(acme.sent)[0].params).toContain('acme');
    expect(corpusStatements(acme.sent)[0].params).not.toContain('globex');
    expect(corpusStatements(globex.sent)[0].params).toContain('globex');
    expect(corpusStatements(globex.sent)[0].params).not.toContain('acme');
  });

  it('keeps the organization filter when narrowing by document or folder', async () => {
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      refs: ['handbook.pdf'],
      folder: '/hr',
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    // The narrowing filters come AFTER the organization filter, so they can
    // only ever reduce what it already allowed.
    expect(statement.text.indexOf('c.org_slug = $2')).toBeLessThan(
      statement.text.indexOf('d.file_id = ANY'),
    );
    expect(statement.params).toContain('acme');
    expect(statement.params).toContain('/hr');
  });

  it('matches a folder prefix only at a separator', async () => {
    // Otherwise "/reports" would also match "/reports-archive".
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      folder: '/reports',
      embedding: EMBEDDING,
    });
    expect(corpusStatements(sent)[0].text).toContain("|| '/'");
  });

  it('passes the query vector as a parameter, never as interpolated text', async () => {
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    expect(statement.text).toContain('$1::vector');
    expect(statement.params[0]).toBe(JSON.stringify(EMBEDDING));
  });
});

describe('the web corpus is scoped by membership', () => {
  it('joins through the organization membership on both legs', async () => {
    // Web pages are fetched once per domain and shared inside one database, so
    // the membership join is the ONLY thing that scopes this corpus.
    const { sql, sent } = recorder();
    const reader = new WebCorpusReader(sql, 'acme');
    await reader.keyword(LEG);
    await reader.dense({ ...LEG, embedding: EMBEDDING });

    const statements = corpusStatements(sent);
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      expect(statement.text).toContain('website_org_memberships');
      expect(statement.text).toContain('m.org_slug = $2');
      expect(statement.params).toContain('acme');
    }
  });

  it('does not let one organization see a domain another registered', async () => {
    const acme = recorder();
    const globex = recorder();
    await new WebCorpusReader(acme.sql, 'acme').keyword(LEG);
    await new WebCorpusReader(globex.sql, 'globex').keyword(LEG);
    expect(corpusStatements(acme.sent)[0].params).toContain('acme');
    expect(corpusStatements(globex.sent)[0].params).toContain('globex');
    expect(corpusStatements(acme.sent)[0].params).not.toContain('globex');
  });
});

describe('the keyword leg degrades instead of failing', () => {
  const degradations: Array<[string, string]> = [
    ['there is no paradedb schema', '3F000'],
    ['the match operator does not exist', '42883'],
    ['the index reports corruption', 'XX001'],
    ['the index reports an internal error', 'XX000'],
    ['the corpus has not been created yet', '42P01'],
  ];

  it.each(degradations)(
    'reports "no keyword index" when %s',
    async (_name, code) => {
      const failing = {
        unsafe: () =>
          Promise.reject(Object.assign(new Error('boom'), { code })),
      } as unknown as Sql;
      const probeOk = Object.assign(
        () => Promise.resolve([{ '?column?': 1 }]),
        failing,
      ) as unknown as Sql;
      const reader = new DocumentCorpusReader(probeOk, 'acme');
      // `null`, not `[]`: a caller must be able to tell "could not run" from
      // "ran and matched nothing".
      expect(await reader.keyword(LEG)).toBeNull();
    },
  );

  it('skips the leg entirely on a database known to have no index', async () => {
    const { sql, sent } = recorder();
    markBm25Unavailable(sql);
    expect(await new DocumentCorpusReader(sql, 'acme').keyword(LEG)).toBeNull();
    expect(corpusStatements(sent)).toEqual([]);
  });

  it('lets an unexpected failure through rather than hiding it', async () => {
    const failing = Object.assign(() => Promise.resolve([{ '?column?': 1 }]), {
      unsafe: () =>
        Promise.reject(
          Object.assign(new Error('permission denied'), { code: '42501' }),
        ),
    }) as unknown as Sql;
    await expect(
      new DocumentCorpusReader(failing, 'acme').keyword(LEG),
    ).rejects.toThrow(/permission denied/);
  });

  it('answers an empty corpus with no results, not an error', async () => {
    const missing = {
      unsafe: () =>
        Promise.reject(Object.assign(new Error('no table'), { code: '42P01' })),
    } as unknown as Sql;
    expect(
      await new DocumentCorpusReader(missing, 'acme').dense({
        ...LEG,
        embedding: EMBEDDING,
      }),
    ).toEqual([]);
  });
});

describe('rows become hits', () => {
  it('carries the stored text, which already includes the contextual header', async () => {
    const { sql } = recorder([
      {
        id: '42',
        chunk_content: 'Handbook › Leave\n\nParental leave is 16 weeks.',
        chunk_index: 3,
        ref: 'handbook.pdf',
        title: 'Handbook',
        url: null,
        modified_at: new Date('2026-01-02T03:04:05Z'),
        hit_offset: null,
        score: 0.87,
      },
    ]);
    const hits = await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    expect(hits[0]).toEqual({
      id: '42',
      corpus: 'documents',
      text: 'Handbook › Leave\n\nParental leave is 16 weeks.',
      chunkIndex: 3,
      source: {
        ref: 'handbook.pdf',
        title: 'Handbook',
        url: null,
        modifiedAt: Date.parse('2026-01-02T03:04:05Z'),
      },
      score: 0.87,
    });
  });

  it('maps the hit offset through when the corpus can establish it', async () => {
    // SUM(length(...)) reaches JS as text; a NULL position stays absent so
    // the model falls back to reading from the start.
    const { sql } = recorder([
      {
        id: '7',
        chunk_content: 'Art. 10 Steuerpflicht…',
        chunk_index: 5,
        ref: 'https://a.ch/law',
        title: 'Law',
        url: 'https://a.ch/law',
        modified_at: null,
        hit_offset: '12480',
        score: 0.9,
      },
    ]);
    const hits = await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    expect(hits[0]?.offset).toBe(12480);
  });
});
