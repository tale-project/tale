import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { computeContentHash } from './hashing.ts';

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
