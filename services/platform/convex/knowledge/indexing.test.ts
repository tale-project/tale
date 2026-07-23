// @vitest-environment node

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { EmbeddingModel } from '../../lib/knowledge/types';
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
}

function fakeDb(
  options: { stored?: StoredRow | null; duplicateId?: string | null } = {},
): FakeDb {
  const statements: string[] = [];
  const unsafe = (text: string): Promise<unknown[]> => {
    statements.push(text.trim());
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
  return { sql, statements };
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
