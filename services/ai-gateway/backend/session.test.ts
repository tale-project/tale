import { describe, expect, it } from 'vitest';

import { createSessionSigner, readApiKey } from './session';

const SECRET = 'a-panel-session-secret';

describe('createSessionSigner', () => {
  it('verifies a cookie it just issued', () => {
    const signer = createSessionSigner(SECRET);
    expect(signer.verify(signer.issue())).toBe(true);
  });

  it('rejects a cookie signed with a different secret', () => {
    const issued = createSessionSigner(SECRET).issue();
    expect(createSessionSigner('another-secret').verify(issued)).toBe(false);
  });

  it('rejects a cookie whose issue time was moved forward', () => {
    const signer = createSessionSigner(SECRET);
    const [, signature] = signer.issue().split('.');
    const future = String(Date.now() + 60_000);
    expect(signer.verify(`${future}.${signature ?? ''}`)).toBe(false);
  });

  it('rejects a cookie older than the lifetime', () => {
    const ttlSeconds = 60;
    const signer = createSessionSigner(SECRET, ttlSeconds);
    const issuedAt = new Date('2026-09-21T10:00:00.000Z');
    const cookie = signer.issue(issuedAt);
    const stillValid = new Date(issuedAt.getTime() + 59_000);
    const expired = new Date(issuedAt.getTime() + 61_000);
    expect(signer.verify(cookie, stillValid)).toBe(true);
    expect(signer.verify(cookie, expired)).toBe(false);
  });

  it('rejects a missing or malformed cookie', () => {
    const signer = createSessionSigner(SECRET);
    expect(signer.verify(undefined)).toBe(false);
    expect(signer.verify('')).toBe(false);
    expect(signer.verify('no-separator')).toBe(false);
    expect(signer.verify('.signature-only')).toBe(false);
  });
});

describe('readApiKey', () => {
  it('reads a bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer the-key' });
    expect(readApiKey(headers)).toBe('the-key');
  });

  it('accepts any casing of the bearer scheme', () => {
    const headers = new Headers({ authorization: 'bearer the-key' });
    expect(readApiKey(headers)).toBe('the-key');
  });

  it('reads the x-api-key header', () => {
    expect(readApiKey(new Headers({ 'x-api-key': 'the-key' }))).toBe('the-key');
  });

  it('answers null when neither header carries a value', () => {
    expect(readApiKey(new Headers())).toBeNull();
    expect(readApiKey(new Headers({ authorization: 'Bearer ' }))).toBeNull();
    expect(readApiKey(new Headers({ authorization: 'Basic abc' }))).toBeNull();
  });
});
