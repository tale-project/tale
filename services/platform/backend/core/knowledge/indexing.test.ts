// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { EmbeddingModel } from '../../../lib/knowledge/types';
import type { Embedder } from './embedding';
import { indexDocument } from './indexing';

/**
 * The write path, exercised against a database double.
 *
 * The three behaviours checked here are the ones whose absence caused real
 * damage: a credential reaching the corpus, unchanged content paying for
 * re-embedding, and a large document that could never finish because every
 * attempt restarted from the beginning.
 *
 * The double answers the two questions the code asks — what is already stored,
 * and is there an identical document — and records every statement, so the
 * assertions are about what was actually sent.
 */

const MODEL: EmbeddingModel = {
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 4,
};

/** An embedder that returns a fixed-width vector per text and counts calls. */
function stubEmbedder(): Embedder & { embedded: string[] } {
  const embedded: string[] = [];
  const embedder = {
    model: MODEL,
    dimensions: MODEL.dimensions,
    embedded,
    embed: (text: string) => {
      embedded.push(text);
      return Promise.resolve([0, 0, 0, 1]);
    },
    embedAll: (texts: readonly string[]) => {
      embedded.push(...texts);
      return Promise.resolve(texts.map(() => [0, 0, 0, 1]));
    },
  };
  return embedder as unknown as Embedder & { embedded: string[] };
}

interface StoredRow {
  content_hash: string | null;
  status: string;
  stored: number;
}

interface FakeDb {
  sql: Sql;
  statements: string[];
  /** Parameters of each statement, index-aligned with `statements`. */
  params: unknown[][];
}

function fakeDb(
  options: { stored?: StoredRow | null; duplicateId?: string | null } = {},
): FakeDb {
  const statements: string[] = [];
  const params: unknown[][] = [];
  const unsafe = (text: string, values: unknown[] = []): Promise<unknown[]> => {
    statements.push(text.trim());
    params.push(values);
    if (text.includes('FROM private_knowledge.documents d')) {
      return Promise.resolve(
        options.stored ? [{ id: 'doc-existing', ...options.stored }] : [],
      );
    }
    if (text.includes('content_hash = $2') && text.includes('completed')) {
      return Promise.resolve(
        options.duplicateId ? [{ id: options.duplicateId }] : [],
      );
    }
    if (text.includes('INSERT INTO private_knowledge.documents')) {
      return Promise.resolve([{ id: 'doc-1' }]);
    }
    if (text.includes('WITH copied AS')) {
      return Promise.resolve([{ count: 7 }]);
    }
    return Promise.resolve([]);
  };
  const sql = {
    unsafe,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn({ unsafe }),
  } as unknown as Sql;
  return { sql, statements, params };
}

const ARGS = {
  orgSlug: 'acme',
  fileId: 'handbook.pdf',
  filename: 'Employment handbook',
  text: '# Employment handbook\n\n## Leave\n\nParental leave is 16 weeks.\n',
};

describe('a credential never reaches the corpus', () => {
  it('refuses the upload before chunking or embedding anything', async () => {
    const db = fakeDb();
    const embedder = stubEmbedder();
    const result = await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder,
      bytes: new TextEncoder().encode(
        'api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n',
      ),
    });

    expect(result.skipped).toBe('secret-detected');
    expect(result.refusal).toContain('credential');
    expect(embedder.embedded).toEqual([]);
    // No chunk was written; only the failure was recorded.
    expect(db.statements.join('\n')).not.toContain(
      'INSERT INTO private_knowledge.chunks',
    );
  });

  it('records the refusal on the document row so the reason survives', async () => {
    const db = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- fake fixture string exercising the ingestion secret scan, not a real key
      bytes: new TextEncoder().encode('-----BEGIN RSA PRIVATE KEY-----\n'),
    });
    expect(db.statements.join('\n')).toContain("'failed'");
  });

  it('indexes a file that only talks about credentials', async () => {
    const db = fakeDb();
    const embedder = stubEmbedder();
    const result = await indexDocument({
      ...ARGS,
      text: 'Rotate the api key every 90 days. Use ${env.TOKEN} in examples.',
      sql: db.sql,
      embedder,
      bytes: new TextEncoder().encode(
        'Rotate the api key every 90 days. Use ${env.TOKEN} in examples.',
      ),
    });
    expect(result.skipped).toBeUndefined();
    expect(embedder.embedded.length).toBeGreaterThan(0);
  });
});

describe('unchanged content is not re-embedded', () => {
  it('skips a document that is already indexed completely', async () => {
    // The stored row claims the hash of exactly this text, which is what makes
    // it the unchanged case.
    const db = fakeDb({
      stored: {
        content_hash: computeContentHash(ARGS.text),
        status: 'completed',
        stored: 99,
      },
    });
    const embedder = stubEmbedder();
    const result = await indexDocument({ ...ARGS, sql: db.sql, embedder });

    expect(result.skipped).toBe('unchanged');
    expect(result.chunksWritten).toBe(0);
    expect(result.chunksStored).toBe(result.chunksTotal);
    expect(embedder.embedded).toEqual([]);
  });

  it('copies identical content instead of embedding it again', async () => {
    const db = fakeDb({ duplicateId: 'doc-original' });
    const embedder = stubEmbedder();
    const result = await indexDocument({ ...ARGS, sql: db.sql, embedder });

    expect(result.chunksWritten).toBe(7);
    expect(embedder.embedded).toEqual([]);
    expect(db.statements.join('\n')).toContain('WITH copied AS');
  });

  it('looks for a duplicate only inside the same organization', async () => {
    // Reusing another organization's embeddings would copy its content and
    // reveal that it holds the same file.
    const db = fakeDb({ duplicateId: 'doc-original' });
    await indexDocument({ ...ARGS, sql: db.sql, embedder: stubEmbedder() });
    const lookup = db.statements.find(
      (statement) =>
        statement.includes('content_hash = $2') &&
        statement.includes('completed'),
    );
    expect(lookup).toContain('org_slug = $1');
  });
});

describe('a large document finishes across several passes', () => {
  const LONG = Array.from(
    { length: 200 },
    (_v, i) =>
      `## Section ${i}\n\nParagraph ${i} with enough words to fill a chunk.\n`,
  ).join('\n');

  it('commits only one slice per pass and reports there is more to do', async () => {
    const db = fakeDb();
    const embedder = stubEmbedder();
    const result = await indexDocument({
      ...ARGS,
      text: LONG,
      sql: db.sql,
      embedder,
      maxChunks: 3,
    });

    expect(result.partial).toBe(true);
    expect(result.chunksWritten).toBe(3);
    expect(result.chunksStored).toBe(3);
    expect(result.chunksTotal).toBeGreaterThan(3);
    expect(embedder.embedded.length).toBe(3);
  });

  it('resumes after the committed prefix instead of starting over', async () => {
    const db = fakeDb({
      stored: {
        content_hash: computeContentHash(LONG),
        status: 'processing',
        stored: 3,
      },
    });
    const embedder = stubEmbedder();
    const result = await indexDocument({
      ...ARGS,
      text: LONG,
      sql: db.sql,
      embedder,
      maxChunks: 3,
    });

    // The work already paid for is not repeated — the whole point, since a
    // document past the invocation window could otherwise never finish.
    expect(result.chunksWritten).toBe(3);
    // Cumulative count: the 3 kept chunks plus this pass's 3.
    expect(result.chunksStored).toBe(6);

    // The resumed pass starts on the fourth chunk, not the first.
    const wholeDocument = stubEmbedder();
    await indexDocument({
      ...ARGS,
      text: LONG,
      sql: fakeDb().sql,
      embedder: wholeDocument,
      maxChunks: 1000,
    });
    expect(embedder.embedded[0]).toBe(wholeDocument.embedded[3]);
    expect(embedder.embedded[0]).not.toBe(wholeDocument.embedded[0]);
    // And the committed chunks are kept rather than wiped.
    expect(db.statements.join('\n')).not.toContain(
      'DELETE FROM private_knowledge.chunks',
    );
  });

  it('discards the stored chunks when the content changed', async () => {
    // New content has different chunk boundaries; keeping the old prefix would
    // splice two documents together.
    const db = fakeDb({
      stored: {
        content_hash: 'a-different-hash',
        status: 'processing',
        stored: 3,
      },
    });
    await indexDocument({
      ...ARGS,
      text: LONG,
      sql: db.sql,
      embedder: stubEmbedder(),
      maxChunks: 3,
    });
    expect(db.statements.join('\n')).toContain(
      'DELETE FROM private_knowledge.chunks',
    );
  });

  it('stamps the document complete on the last slice', async () => {
    const db = fakeDb();
    const result = await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
    });
    expect(result.partial).toBe(false);
    expect(db.statements.join('\n')).toContain("SET status = 'completed'");
  });
});

describe('what gets stored', () => {
  it('embeds and indexes the contextual header with the chunk', async () => {
    const db = fakeDb();
    const embedder = stubEmbedder();
    await indexDocument({ ...ARGS, sql: db.sql, embedder });
    expect(embedder.embedded[0]).toContain('Employment handbook');
    expect(embedder.embedded[0]).toContain('Leave');
  });

  it('refuses a vector of the wrong width', async () => {
    const narrow = {
      model: MODEL,
      dimensions: MODEL.dimensions,
      embed: () => Promise.resolve([0, 0]),
      embedAll: (texts: readonly string[]) =>
        Promise.resolve(texts.map(() => [0, 0])),
    } as unknown as Embedder;
    await expect(
      indexDocument({ ...ARGS, sql: fakeDb().sql, embedder: narrow }),
    ).rejects.toThrow(/dimensional/);
  });

  it('writes nothing for a document with no text', async () => {
    const db = fakeDb();
    const result = await indexDocument({
      ...ARGS,
      text: '   \n  ',
      sql: db.sql,
      embedder: stubEmbedder(),
    });
    expect(result.skipped).toBe('empty');
    expect(db.statements).toEqual([]);
  });
});

describe('document scope is stamped on the corpus row', () => {
  function claim(db: FakeDb): { text: string; params: unknown[] } | undefined {
    const at = db.statements.findIndex((text) =>
      text.includes('INSERT INTO private_knowledge.documents'),
    );
    if (at < 0) return undefined;
    const text = db.statements[at];
    const params = db.params[at];
    if (text === undefined || params === undefined) return undefined;
    return { text, params };
  }

  it('carries the team scope into the claim, insert and conflict-update alike', async () => {
    // Retrieval filters on these columns; a claim that dropped them would
    // leave the document org-wide however carefully the caller scoped it.
    const db = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
      teamIds: ['team-sales'],
      projectId: null,
    });
    const stamped = claim(db);
    expect(stamped).toBeDefined();
    expect(stamped?.text).toContain('team_ids');
    expect(stamped?.text).toContain('project_id');
    expect(stamped?.text).toContain('team_ids = EXCLUDED.team_ids');
    expect(stamped?.text).toContain('team_id = EXCLUDED.team_id');
    expect(stamped?.text).toContain('project_id = EXCLUDED.project_id');
    expect(stamped?.params).toContainEqual(['team-sales']);
    // The deprecated single-column mirror rides along for the transition.
    expect(stamped?.params).toContain('team-sales');
  });

  it('stamps EVERY team of a shared document, first team mirrored', async () => {
    // A document shared to [sales, support] must reach the corpus with both
    // teams — stamping only the first is exactly the bug that hid it from
    // support members' retrieval while the library listed it for them.
    const db = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
      teamIds: ['team-sales', 'team-support'],
      projectId: null,
    });
    const stamped = claim(db);
    // $7/$8 are team_ids/team_id in the claim statement.
    expect(stamped?.params[6]).toEqual(['team-sales', 'team-support']);
    expect(stamped?.params[7]).toBe('team-sales');
  });

  it('stamps the conversation an emailed attachment arrived on', async () => {
    // Without this the row lands with every scope column NULL — an org-hub
    // document — and the inbox attachment becomes readable by the whole
    // organization. The stamp is also the QUESTION, not the answer: retrieval
    // re-asks the conversation's current assignment, so a reassignment moves
    // the file without touching this row.
    const db = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
      teamIds: null,
      projectId: null,
      conversationId: 'conv_inbound',
    });
    const stamped = claim(db);
    expect(stamped?.text).toContain('conversation_id');
    expect(stamped?.text).toContain(
      'conversation_id = EXCLUDED.conversation_id',
    );
    // $10 is conversation_id, after team_ids/team_id/project_id.
    expect(stamped?.params[9]).toBe('conv_inbound');
  });

  it('carries the project scope, and stamps NULLs for a hub document', async () => {
    const project = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: project.sql,
      embedder: stubEmbedder(),
      teamIds: null,
      projectId: 'proj-42',
    });
    expect(claim(project)?.params).toContain('proj-42');

    // A caller that names no scope stamps the org hub (all NULLs), which is
    // also what plain file uploads without a document row get. An EMPTY team
    // list reads the same as none — never an empty array on the row.
    for (const teamIds of [undefined, [] as string[]]) {
      const hub = fakeDb();
      await indexDocument({
        ...ARGS,
        sql: hub.sql,
        embedder: stubEmbedder(),
        ...(teamIds !== undefined ? { teamIds } : {}),
      });
      const stamped = claim(hub);
      // $7/$8/$9 are team_ids/team_id/project_id in the claim statement.
      expect(stamped?.params[6]).toBeNull();
      expect(stamped?.params[7]).toBeNull();
      expect(stamped?.params[8]).toBeNull();
      // …and it is not a conversation row either.
      expect(stamped?.params[9]).toBeNull();
    }
  });
});

describe('the chunk header announces the title, not just the filename', () => {
  // The header is prepended to every chunk, so it is what the keyword leg
  // matches and what the embedding sees. An emailed attachment passes a title
  // carrying the mail it arrived on; a Document Hub file passes none and must
  // keep announcing its filename exactly as before.
  function chunkParams(db: FakeDb): unknown[] {
    const at = db.statements.findIndex((text) =>
      text.includes('INSERT INTO private_knowledge.chunks'),
    );
    return at < 0 ? [] : (db.params[at] ?? []);
  }

  it('uses the supplied title in the written chunk', async () => {
    const db = fakeDb();
    await indexDocument({
      ...ARGS,
      sql: db.sql,
      embedder: stubEmbedder(),
      title: 'cv.pdf — Application — Field Sales Agent',
    });

    const flat = chunkParams(db)
      .map((value) => (typeof value === 'string' ? value : ''))
      .join('\n');
    expect(flat).toContain('Application — Field Sales Agent');
  });

  it('falls back to the filename when no title is supplied', async () => {
    const db = fakeDb();
    await indexDocument({ ...ARGS, sql: db.sql, embedder: stubEmbedder() });

    const flat = chunkParams(db)
      .map((value) => (typeof value === 'string' ? value : ''))
      .join('\n');
    expect(flat).toContain(ARGS.filename);
  });
});
