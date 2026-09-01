// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

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
      expect(statement.text).toContain("d.status = 'completed'");
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

  it("applies the caller's access scope to both legs", async () => {
    // Team/project scoping is what stops a scoped document from leaking
    // org-wide; a leg without the clause would leak on exactly that leg.
    const { sql, sent } = recorder();
    const reader = new DocumentCorpusReader(sql, 'acme');
    const access = {
      teamIds: ['team-a', 'team-b'],
      projectIds: ['proj-1'],
      includeHub: true,
    };
    await reader.keyword({ ...LEG, access });
    await reader.dense({ ...LEG, access, embedding: EMBEDDING });

    const statements = corpusStatements(sent);
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      // Hub rows are the unscoped ones — all scope columns NULL — and the
      // caller's teams/projects widen from there; nothing else matches.
      // `conversation_id IS NULL` belongs to that list: an emailed attachment
      // carries no team and no project, so without it every indexed inbox
      // attachment would read as an org-hub document.
      expect(statement.text).toContain(
        '(d.team_ids IS NULL AND d.team_id IS NULL AND d.project_id IS NULL' +
          ' AND d.conversation_id IS NULL)',
      );
      expect(statement.text).toContain('d.project_id = ANY(');
      expect(statement.params).toContainEqual(['team-a', 'team-b']);
      expect(statement.params).toContainEqual(['proj-1']);
      // The org filter still precedes: access can only narrow within it.
      expect(statement.text.indexOf('c.org_slug = $2')).toBeLessThan(
        statement.text.indexOf('d.team_ids && '),
      );
    }
  });

  it('matches a shared document by ANY of its teams, on both legs', async () => {
    // A document shared to [sales, support] must be retrievable by a support
    // member even though sales is stamped first — the single-column era
    // matched only the first team and silently hid the rest. `&&` is array
    // overlap: one common team suffices.
    const { sql, sent } = recorder();
    const reader = new DocumentCorpusReader(sql, 'acme');
    const access = {
      teamIds: ['team-support'],
      projectIds: [],
      includeHub: false,
    };
    await reader.keyword({ ...LEG, access });
    await reader.dense({ ...LEG, access, embedding: EMBEDDING });

    const statements = corpusStatements(sent);
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      expect(statement.text).toContain('d.team_ids && $3::text[]');
      // The caller's teams bind ONE parameter, shared by the overlap test
      // and the single-column fallback — the two can never disagree.
      expect(statement.text).toContain(
        '(d.team_ids IS NULL AND d.team_id = ANY($3))',
      );
      expect(
        statement.params.filter(
          (param) => Array.isArray(param) && param[0] === 'team-support',
        ),
      ).toHaveLength(1);
    }
  });

  it('reads a row without the array stamp by its single-team mirror only', async () => {
    // Rows written before the `team_ids` DDL (or by a not-yet-upgraded
    // writer) carry only `team_id`; the fallback leg keeps them retrievable,
    // but ONLY when the array is absent — a stamped array is the truth and
    // the stale mirror must not widen it.
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      access: { teamIds: ['team-a'], projectIds: [], includeHub: false },
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    expect(statement.text).toContain(
      'd.team_ids && $3::text[] OR (d.team_ids IS NULL AND d.team_id = ANY($3))',
    );
  });

  it('drops the hub disjunct when the scope excludes it', async () => {
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      access: { teamIds: ['team-a'], projectIds: [], includeHub: false },
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    expect(statement.text).not.toContain('d.team_id IS NULL');
    expect(statement.text).toContain('d.team_ids && ');
  });

  it('admits conversation rows on both legs when the scope allows them', async () => {
    // The SQL side only ADMITS an emailed attachment — it cannot know who may
    // read the mail, because that answer lives in the conversation's current
    // assignment. So the clause is deliberately the widest possible one, and
    // `filterRetrievableRagFileIds` is what decides each row.
    const { sql, sent } = recorder();
    const reader = new DocumentCorpusReader(sql, 'acme');
    const access = {
      teamIds: [],
      projectIds: [],
      includeHub: true,
      includeConversationScoped: true,
    };
    await reader.keyword({ ...LEG, access });
    await reader.dense({ ...LEG, access, embedding: EMBEDDING });

    const statements = corpusStatements(sent);
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      expect(statement.text).toContain('d.conversation_id IS NOT NULL');
    }
  });

  it('omits the conversation disjunct for a scope that excludes them', async () => {
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      access: { teamIds: ['team-a'], projectIds: [], includeHub: true },
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    expect(statement.text).not.toContain('d.conversation_id IS NOT NULL');
    // The hub clause still names the column, so this must not be read as
    // "the column is absent" — only the admitting disjunct is.
    expect(statement.text).toContain('d.conversation_id IS NULL');
  });

  it('selects the conversation id so a hit can name where it arrived', async () => {
    const { sql, sent } = recorder();
    const reader = new DocumentCorpusReader(sql, 'acme');
    await reader.keyword({ ...LEG });
    await reader.dense({ ...LEG, embedding: EMBEDDING });
    for (const statement of corpusStatements(sent)) {
      expect(statement.text).toContain('d.conversation_id');
    }
  });

  it('adds no scope clause for an org-wide caller', async () => {
    // Absent access = the admin-keyed surfaces (org REST key, MCP lane):
    // exactly the pre-scoping statement, so nothing changes for them.
    const { sql, sent } = recorder();
    await new DocumentCorpusReader(sql, 'acme').dense({
      ...LEG,
      embedding: EMBEDDING,
    });
    const statement = corpusStatements(sent)[0];
    expect(statement.text).not.toContain('d.team_id');
    // The PREDICATE, not the column. `d.project_id` is now also SELECTed, so a
    // caller can be told a hit belongs to a retired project; that is not a
    // scope clause and must not read as one.
    expect(statement.text).not.toContain('d.project_id = ANY');
    expect(statement.text).not.toContain('d.conversation_id IS NOT NULL');
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

  it('names the remedy when a COLUMN is missing, not "no corpus"', async () => {
    // A corpus whose table exists but lacks a column this release selects is a
    // deployment mid-upgrade: the bundled knowledge database applies its dbmate
    // migrations at container start, so a platform image updated without
    // restarting that container leaves every search returning nothing.
    //
    // It must degrade, and the line must not borrow the missing-table message —
    // that one sends the operator looking for an empty corpus.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const failing = {
        unsafe: () =>
          Promise.reject(
            Object.assign(
              new Error('column d.conversation_id does not exist'),
              {
                code: '42703',
              },
            ),
          ),
      } as unknown as Sql;
      const probeOk = Object.assign(
        () => Promise.resolve([{ '?column?': 1 }]),
        failing,
      ) as unknown as Sql;

      expect(await new DocumentCorpusReader(probeOk, 'acme').keyword(LEG)).toBe(
        null,
      );
      expect(
        await new DocumentCorpusReader(probeOk, 'acme').dense({
          ...LEG,
          embedding: EMBEDDING,
        }),
      ).toEqual([]);

      const lines = warn.mock.calls.map((call) => call.join(' '));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toContain('missing a column');
        expect(line).toContain('knowledge database container');
        expect(line).not.toContain('not created yet');
      }
    } finally {
      warn.mockRestore();
    }
  });

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
