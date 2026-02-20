import { describe, expect, it } from 'vitest';

import { computeContentHash } from './content_hash';

describe('computeContentHash', () => {
  it('returns consistent hash for same input', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different input', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world!');
    expect(hash1).not.toBe(hash2);
  });

  it('returns 8-character hex string', () => {
    const hash = computeContentHash('test');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles empty string', () => {
    const hash = computeContentHash('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles long content', () => {
    const longContent = 'x'.repeat(100000);
    const hash = computeContentHash(longContent);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles unicode content', () => {
    const hash = computeContentHash('你好世界 🌍');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
