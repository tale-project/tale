// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putOrgBlobBytes } from '../files/service.ts';
import {
  ARTIFACT_MAX_BYTES,
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
});
