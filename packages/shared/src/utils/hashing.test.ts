import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeContentHash, computeFileHash } from './hashing.ts';

function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256')
    .update(
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
    )
    .digest('hex');
}

describe('computeContentHash', () => {
  it('hashes empty bytes', () => {
    expect(computeContentHash(new Uint8Array())).toBe(
      sha256Hex(new Uint8Array()),
    );
  });

  it('hashes known content', () => {
    const content = Buffer.from('hello world');
    expect(computeContentHash(content)).toBe(sha256Hex(content));
  });

  it('is deterministic', () => {
    const content = Buffer.from('test data for dedup');
    expect(computeContentHash(content)).toBe(computeContentHash(content));
  });

  it('produces different hashes for different content', () => {
    expect(computeContentHash(Buffer.from('a'))).not.toBe(
      computeContentHash(Buffer.from('b')),
    );
  });

  it('encodes strings as UTF-8', () => {
    expect(computeContentHash('hello world')).toBe(sha256Hex('hello world'));
  });
});

describe('computeFileHash', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'hashing-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches the content hash of the same bytes', async () => {
    const content = Buffer.from('file content for hashing test');
    const filePath = path.join(dir, 'test.txt');
    writeFileSync(filePath, content);
    expect(await computeFileHash(filePath)).toBe(computeContentHash(content));
  });

  it('hashes an empty file', async () => {
    const filePath = path.join(dir, 'empty.txt');
    writeFileSync(filePath, Buffer.alloc(0));
    expect(await computeFileHash(filePath)).toBe(sha256Hex(new Uint8Array()));
  });

  it('hashes a large file', async () => {
    const content = Buffer.alloc(100_000, 'x');
    const filePath = path.join(dir, 'large.bin');
    writeFileSync(filePath, content);
    expect(await computeFileHash(filePath)).toBe(sha256Hex(content));
  });
});
