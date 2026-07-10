// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TableShape } from '../framework/schema_fingerprint';
import {
  canonicalRow,
  diffWorldDigests,
  digestDb,
  digestFs,
  stableStringify,
  type WorldDigest,
} from './digest.testkit';
import { validateDoc, validateValue } from './schema_validate.testkit';

describe('stableStringify / canonicalRow', () => {
  it('sorts keys recursively and strips identity fields', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
    const row = canonicalRow({
      _id: 'k123',
      _creationTime: 999,
      name: 'x',
      meta: { b: 2, a: 1 },
    });
    expect(row).toBe('{"meta":{"a":1,"b":2},"name":"x"}');
  });

  it('applies per-table drop fields', () => {
    expect(canonicalRow({ a: 1, syncedAt: 5 }, ['syncedAt'])).toBe('{"a":1}');
  });
});

describe('digestDb', () => {
  it('is order- and identity-insensitive but content-sensitive', async () => {
    const rowsA = [
      { _id: '1', _creationTime: 1, n: 1 },
      { _id: '2', _creationTime: 2, n: 2 },
    ];
    const rowsB = [
      { _id: '9', _creationTime: 9, n: 2 },
      { _id: '8', _creationTime: 8, n: 1 },
    ];
    const a = await digestDb(['t'], async () => rowsA);
    const b = await digestDb(['t'], async () => rowsB);
    expect(a).toEqual(b);

    const c = await digestDb(['t'], async () => [
      { _id: '1', _creationTime: 1, n: 1 },
      { _id: '2', _creationTime: 2, n: 3 },
    ]);
    expect(a).not.toEqual(c);
  });

  it('skips centrally exempt tables', async () => {
    const digest = await digestDb(['migrationLedger', 't'], async () => [
      { _id: '1', _creationTime: 1 },
    ]);
    expect(Object.keys(digest)).toEqual(['t']);
  });
});

describe('digestFs', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tale-digest-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('hashes JSON key-order-insensitively, skips sidecars, ignores empty dirs', async () => {
    await mkdir(path.join(root, 'org1', 'branding'), { recursive: true });
    await mkdir(path.join(root, 'org1', 'governance'), { recursive: true }); // empty
    await mkdir(path.join(root, '.migration-snapshots', 'x'), {
      recursive: true,
    });
    await writeFile(
      path.join(root, 'org1', 'branding', 'branding.json'),
      '{"accentColor":"#111111","logoFilename":"a.png"}',
    );
    await writeFile(
      path.join(root, '.migration-snapshots', 'x', 'old.json'),
      '{}',
    );
    await writeFile(path.join(root, 'org1', 'raw.txt'), 'bytes');

    const a = await digestFs(root);
    expect(Object.keys(a).sort()).toEqual([
      'org1/branding/branding.json',
      'org1/raw.txt',
    ]);

    // Same JSON, different key order → same hash.
    await writeFile(
      path.join(root, 'org1', 'branding', 'branding.json'),
      '{"logoFilename":"a.png","accentColor":"#111111"}',
    );
    expect((await digestFs(root))['org1/branding/branding.json']).toBe(
      a['org1/branding/branding.json'],
    );

    // Different content → different hash.
    await writeFile(
      path.join(root, 'org1', 'branding', 'branding.json'),
      '{"accentColor":"#222222","logoFilename":"a.png"}',
    );
    expect((await digestFs(root))['org1/branding/branding.json']).not.toBe(
      a['org1/branding/branding.json'],
    );
  });
});

describe('diffWorldDigests', () => {
  it('reports missing/extra rows and fs changes; equal digests diff empty', () => {
    const before: WorldDigest = {
      db: { t: ['{"n":1}', '{"n":2}'], u: ['{"x":1}'] },
      fs: { 'a.json': 'h1', 'b.txt': 'h2' },
    };
    const equal: WorldDigest = {
      db: { t: ['{"n":1}', '{"n":2}'], u: ['{"x":1}'] },
      fs: { 'a.json': 'h1', 'b.txt': 'h2' },
    };
    expect(diffWorldDigests(before, equal)).toEqual([]);

    const after: WorldDigest = {
      db: { t: ['{"n":1}', '{"n":3}'] },
      fs: { 'a.json': 'h9', 'c.txt': 'h3' },
    };
    const diff = diffWorldDigests(before, after);
    expect(
      diff.some((l) => l.includes('t: MISSING after') && l.includes('{"n":2}')),
    ).toBe(true);
    expect(
      diff.some((l) => l.includes('t: EXTRA after') && l.includes('{"n":3}')),
    ).toBe(true);
    expect(
      diff.some((l) => l.includes('table u') && l.includes('absent after')),
    ).toBe(true);
    expect(diff.some((l) => l.includes('a.json: content differs'))).toBe(true);
    expect(diff.some((l) => l.includes('b.txt: missing after'))).toBe(true);
    expect(diff.some((l) => l.includes('c.txt: created'))).toBe(true);
  });
});

describe('validateValue / validateDoc', () => {
  const shape: TableShape = {
    name: { ft: { type: 'string' }, optional: false },
    kind: {
      ft: {
        type: 'union',
        value: [
          { type: 'literal', value: 'chat' },
          { type: 'literal', value: 'task' },
        ],
      },
      optional: true,
    },
    contactId: { ft: { type: 'id', tableName: 'contacts' }, optional: true },
    tags: {
      ft: { type: 'array', value: { type: 'string' } },
      optional: true,
    },
    meta: {
      ft: {
        type: 'object',
        value: {
          score: { fieldType: { type: 'number' }, optional: false },
          note: { fieldType: { type: 'string' }, optional: true },
        },
      },
      optional: true,
    },
    labels: {
      ft: {
        type: 'record',
        keys: { type: 'string' },
        values: { fieldType: { type: 'string' }, optional: false },
      },
      optional: true,
    },
  };

  it('accepts a fully valid document', () => {
    expect(
      validateDoc(
        {
          _id: 'x',
          _creationTime: 1,
          name: 'a',
          kind: 'chat',
          contactId: 'c1',
          tags: ['t1'],
          meta: { score: 3, note: 'ok' },
          labels: { red: '#f00' },
        },
        shape,
        'threads',
      ),
    ).toBeNull();
  });

  it('pinpoints failures with a path', () => {
    expect(validateDoc({ kind: 'chat' }, shape, 'threads')).toContain(
      'threads.name: required field missing',
    );
    expect(
      validateDoc({ name: 'a', kind: 'nope' }, shape, 'threads'),
    ).toContain('no union member matches');
    expect(
      validateDoc({ name: 'a', tags: ['x', 7] }, shape, 'threads'),
    ).toContain('threads.tags[1]');
    expect(
      validateDoc({ name: 'a', meta: { note: 'n' } }, shape, 'threads'),
    ).toContain('threads.meta.score: required field missing');
    expect(
      validateDoc(
        { name: 'a', meta: { score: 1, extra: true } },
        shape,
        'threads',
      ),
    ).toContain('threads.meta.extra: field not declared');
  });

  it('rejects undeclared top-level fields — the leftover-legacy-field catch', () => {
    expect(
      validateDoc({ name: 'a', customerId: 'legacy' }, shape, 'threads'),
    ).toBe('threads.customerId: field not declared in the current schema');
  });

  it('flags unknown validator nodes instead of passing them silently', () => {
    expect(validateValue(1, { type: 'vectorIndex??' }, 'p')).toContain(
      'unknown validator node type',
    );
  });
});
