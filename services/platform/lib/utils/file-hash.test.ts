import { describe, it, expect } from 'vitest';

import { calculateFileHash } from './file-hash';

describe('calculateFileHash', () => {
  it('returns consistent SHA-256 hex string for the same content', async () => {
    const content = new TextEncoder().encode('hello world');
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const hash1 = await calculateFileHash(file);
    const hash2 = await calculateFileHash(file);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns different hashes for different content', async () => {
    const file1 = new File(['aaa'], 'a.txt');
    const file2 = new File(['bbb'], 'b.txt');

    const hash1 = await calculateFileHash(file1);
    const hash2 = await calculateFileHash(file2);

    expect(hash1).not.toBe(hash2);
  });

  it('handles empty files', async () => {
    const file = new File([], 'empty.txt');
    const hash = await calculateFileHash(file);
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns correct SHA-256 for known input', async () => {
    const file = new File(['hello world'], 'test.txt');
    const hash = await calculateFileHash(file);
    // SHA-256 of "hello world"
    expect(hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});
