// @vitest-environment node

import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putOrgBlobBytes } from '../files/service.ts';
import {
  ARTIFACT_MAX_BYTES,
  holdsFetchedFiles,
  keepFetchedDocument,
  readThreadFiles,
  storeThreadArtifact,
} from './artifacts.ts';

vi.mock('../files/service.ts', () => ({
  putOrgBlobBytes: vi.fn(() => Promise.resolve('s3:acme/new')),
}));

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(rows: unknown[] = []): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve(rows);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return { sql: fn as unknown as Sql, statements };
}

const SCOPE = {
  organizationId: 'org_1',
  userId: 'user_1',
  threadId: 'root_1',
  projectId: 'proj_1',
};

beforeEach(() => {
  vi.mocked(putOrgBlobBytes).mockClear();
});

describe('storeThreadArtifact', () => {
  it('stores the bytes in the org’s store and binds the file to the conversation [CHAT-R19]', async () => {
    const { sql, statements } = fakeSql();
    const bytes = new TextEncoder().encode('a,b\n1,2\n');

    const artifact = await storeThreadArtifact(sql, SCOPE, {
      name: 'table.csv',
      mediaType: 'text/csv',
      bytes,
    });

    expect(putOrgBlobBytes).toHaveBeenCalledWith(sql, 'org_1', {
      bytes,
      contentType: 'text/csv',
    });
    expect(artifact).toEqual({
      ref: 's3:acme/new',
      name: 'table.csv',
      mediaType: 'text/csv',
      sizeBytes: bytes.byteLength,
    });
    const insert = statements[0];
    expect(insert?.text).toContain('INSERT INTO app.file_metadata');
    // The person's own file (erasure takes it), an agent's product
    // (retention covers it), the conversation's (access follows it), never
    // indexed.
    expect(insert?.values).toEqual([
      'org_1',
      's3:acme/new',
      'table.csv',
      'text/csv',
      bytes.byteLength,
      'user_1',
      'root_1',
      'proj_1',
      expect.any(Number),
    ]);
    expect(insert?.text).toContain("'agent'");
    expect(insert?.text).toContain('true');
  });

  it('refuses an empty or oversized file before storing anything', async () => {
    const { sql } = fakeSql();
    await expect(
      storeThreadArtifact(sql, SCOPE, {
        name: 'e.txt',
        mediaType: 'text/plain',
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow(/empty/);
    await expect(
      storeThreadArtifact(sql, SCOPE, {
        name: 'big.bin',
        mediaType: 'application/octet-stream',
        bytes: new Uint8Array(ARTIFACT_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/at most/);
    expect(putOrgBlobBytes).not.toHaveBeenCalled();
  });
});

describe('readThreadFiles', () => {
  it('finds the conversation’s files among the refs, by lineage [CHAT-R19]', async () => {
    const row = {
      ref: 's3:acme/a',
      name: 'a.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 10,
    };
    const { sql, statements } = fakeSql([row]);

    const files = await readThreadFiles(
      sql,
      { organizationId: 'org_1', threadIds: ['root_1', 'branch_1'] },
      ['s3:acme/a', 's3:other/b'],
    );

    expect([...files.entries()]).toEqual([['s3:acme/a', row]]);
    expect(statements[0]?.values).toEqual([
      'org_1',
      ['root_1', 'branch_1'],
      ['s3:acme/a', 's3:other/b'],
    ]);
  });

  it('reads nothing for no refs', async () => {
    const { sql, statements } = fakeSql();
    await expect(
      readThreadFiles(sql, { organizationId: 'o', threadIds: ['t'] }, []),
    ).resolves.toEqual(new Map());
    expect(statements).toHaveLength(0);
  });

  it('takes a document read from a link as it takes an upload, by lineage alone [FILE-R10]', async () => {
    const { sql, statements } = fakeSql();

    await readThreadFiles(
      sql,
      { organizationId: 'org_1', threadIds: ['root_1'] },
      ['s3:acme/new'],
    );

    // The organization and the lineage scope the read, the source does not:
    // the file web_fetch kept, bound to the lineage root, is staged by its
    // ref in this conversation and in no other.
    expect(statements[0]?.text).toMatch(/thread_id = ANY/);
    expect(statements[0]?.text).not.toMatch(/\bsource\b/);
  });
});

describe('keepFetchedDocument', () => {
  const PDF = new TextEncoder().encode('%PDF-1.7 a linked report');
  const FILE = {
    name: 'q3-report.pdf',
    mediaType: 'application/pdf',
    bytes: PDF,
    url: 'https://cdn.example.com/files/q3-report.pdf',
  };
  const SHA256 = createHash('sha256').update(PDF).digest('hex');

  it('stores the fetched bytes as a file of the conversation, marked as fetched from its address [FILE-R10]', async () => {
    const { sql, statements } = fakeSql();

    const kept = await keepFetchedDocument(sql, SCOPE, FILE);

    expect(putOrgBlobBytes).toHaveBeenCalledWith(sql, 'org_1', {
      bytes: PDF,
      contentType: 'application/pdf',
    });
    expect(kept).toEqual({
      ref: 's3:acme/new',
      name: 'q3-report.pdf',
      mediaType: 'application/pdf',
      sizeBytes: PDF.byteLength,
    });
    // First the conversation's copy of these bytes from this address is
    // looked for — on the lineage root, among fetched files only.
    const [lookup, insert] = statements;
    expect(lookup?.text).toContain('SELECT storage_ref');
    expect(lookup?.text).toContain("source = 'web'");
    expect(lookup?.values).toEqual([
      'org_1',
      'root_1',
      'https://cdn.example.com/files/q3-report.pdf',
      SHA256,
    ]);
    // Then it is stored as an upload is: the person's (quota, erasure), the
    // conversation's (access), the thread's project — but fetched from the
    // web, not attached, and never indexed.
    expect(insert?.text).toContain('INSERT INTO app.file_metadata');
    expect(insert?.text).toContain("'web'");
    expect(insert?.text).toContain('true');
    expect(insert?.values).toEqual([
      'org_1',
      's3:acme/new',
      'q3-report.pdf',
      'application/pdf',
      PDF.byteLength,
      'https://cdn.example.com/files/q3-report.pdf',
      SHA256,
      'user_1',
      'root_1',
      'proj_1',
      expect.any(Number),
    ]);
  });

  it('answers the file already kept for the same address and bytes, storing nothing', async () => {
    const row = {
      ref: 's3:acme/kept',
      name: 'q3-report.pdf',
      mediaType: 'application/pdf',
      sizeBytes: PDF.byteLength,
    };
    const { sql, statements } = fakeSql([row]);

    await expect(keepFetchedDocument(sql, SCOPE, FILE)).resolves.toEqual(row);

    expect(statements).toHaveLength(1);
    expect(putOrgBlobBytes).not.toHaveBeenCalled();
  });

  it('refuses an empty or oversized document before storing anything', async () => {
    const { sql, statements } = fakeSql();
    await expect(
      keepFetchedDocument(sql, SCOPE, { ...FILE, bytes: new Uint8Array() }),
    ).rejects.toThrow(/empty/);
    await expect(
      keepFetchedDocument(sql, SCOPE, {
        ...FILE,
        bytes: new Uint8Array(ARTIFACT_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/at most/);
    expect(statements).toHaveLength(0);
    expect(putOrgBlobBytes).not.toHaveBeenCalled();
  });
});

describe('holdsFetchedFiles', () => {
  it('asks whether a thread of the lineage holds a fetched file [FILE-R10]', async () => {
    const { sql, statements } = fakeSql([{ held: true }]);

    await expect(
      holdsFetchedFiles(sql, {
        organizationId: 'org_1',
        threadIds: ['root_1', 'branch_1'],
      }),
    ).resolves.toBe(true);

    expect(statements[0]?.text).toContain("source = 'web'");
    expect(statements[0]?.values).toEqual(['org_1', ['root_1', 'branch_1']]);
  });

  it('answers no for a conversation without one, or without threads', async () => {
    const { sql, statements } = fakeSql([{ held: false }]);
    await expect(
      holdsFetchedFiles(sql, { organizationId: 'org_1', threadIds: ['t'] }),
    ).resolves.toBe(false);
    await expect(
      holdsFetchedFiles(sql, { organizationId: 'org_1', threadIds: [] }),
    ).resolves.toBe(false);
    expect(statements).toHaveLength(1);
  });
});
