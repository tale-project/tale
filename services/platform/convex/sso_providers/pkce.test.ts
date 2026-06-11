import { describe, expect, it } from 'vitest';

import { generatePkcePair } from './pkce';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('generatePkcePair (#1506)', () => {
  it('produces a base64url verifier within the RFC 7636 length window', async () => {
    const { verifier } = await generatePkcePair();
    expect(verifier).toMatch(BASE64URL);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('derives the challenge as base64url(SHA-256(verifier))', async () => {
    const { verifier, challenge } = await generatePkcePair();
    expect(challenge).toMatch(BASE64URL);
    expect(challenge).toBe(await s256(verifier));
  });

  it('generates a fresh verifier per call', async () => {
    const [a, b] = await Promise.all([generatePkcePair(), generatePkcePair()]);
    expect(a.verifier).not.toBe(b.verifier);
  });
});
