import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  decodeJwtClaims,
  expiresAtFrom,
  generatePkce,
  generateState,
  isRecord,
  parseAuthorizationCallback,
  readObject,
  readString,
  resetsAtFromSeconds,
  toIsoInstant,
  toUtilization,
} from './oauth';

describe('generatePkce', () => {
  it('derives the challenge from the verifier with S256', () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });

  it('produces a new pair every call', () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
    expect(generateState()).not.toBe(generateState());
  });

  it('stays inside the URL-safe alphabet', () => {
    expect(generatePkce().verifier).toMatch(/^[\w-]+$/);
    expect(generateState()).toMatch(/^[\w-]+$/);
  });
});

describe('parseAuthorizationCallback', () => {
  it('reads a whole redirect URL', () => {
    expect(
      parseAuthorizationCallback(
        'http://localhost:1455/auth/callback?code=abc123&state=xyz',
      ),
    ).toEqual({ code: 'abc123', state: 'xyz' });
  });

  it('reads a redirect URL whose query carries no state', () => {
    expect(
      parseAuthorizationCallback('http://localhost:1455/auth/callback?code=a'),
    ).toEqual({ code: 'a', state: null });
  });

  it("reads Anthropic's code#state pair", () => {
    expect(parseAuthorizationCallback('abc123#state-value')).toEqual({
      code: 'abc123',
      state: 'state-value',
    });
  });

  it('reads a bare code', () => {
    expect(parseAuthorizationCallback('  abc123  ')).toEqual({
      code: 'abc123',
      state: null,
    });
  });

  it('answers an empty code for an empty paste', () => {
    expect(parseAuthorizationCallback('   ')).toEqual({
      code: '',
      state: null,
    });
  });

  it('decodes a percent-escaped code from a redirect URL', () => {
    expect(
      parseAuthorizationCallback('http://localhost/cb?code=a%2Bb&state=s'),
    ).toEqual({ code: 'a+b', state: 's' });
  });
});

describe('time helpers', () => {
  it('turns expires_in seconds into an absolute instant', () => {
    const now = new Date('2026-09-21T10:00:00.000Z');
    expect(expiresAtFrom(3600, now)).toBe('2026-09-21T11:00:00.000Z');
  });

  it('answers null when the vendor omits expires_in', () => {
    expect(expiresAtFrom(undefined)).toBeNull();
    expect(expiresAtFrom('3600')).toBeNull();
  });

  it('normalizes an ISO timestamp and epoch seconds alike', () => {
    expect(toIsoInstant('2026-09-21T10:00:00Z')).toBe(
      '2026-09-21T10:00:00.000Z',
    );
    expect(toIsoInstant(1_790_000_000)).toBe(
      new Date(1_790_000_000_000).toISOString(),
    );
    expect(toIsoInstant('not a date')).toBeNull();
    expect(toIsoInstant(null)).toBeNull();
  });

  it('turns a relative reset into an absolute one', () => {
    const now = new Date('2026-09-21T10:00:00.000Z');
    expect(resetsAtFromSeconds(1800, now)).toBe('2026-09-21T10:30:00.000Z');
    expect(resetsAtFromSeconds(undefined, now)).toBeNull();
  });
});

describe('toUtilization', () => {
  it('clamps to the range the panel draws', () => {
    expect(toUtilization(42.4)).toBe(42.4);
    expect(toUtilization(-1)).toBe(0);
    expect(toUtilization(140)).toBe(100);
  });

  it('answers null for anything that is not a figure', () => {
    expect(toUtilization('80')).toBeNull();
    expect(toUtilization(Number.NaN)).toBeNull();
    expect(toUtilization(undefined)).toBeNull();
  });
});

describe('payload readers', () => {
  it('narrows a plain object and rejects an array', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([1])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('reads only non-empty strings', () => {
    const source = { name: 'value', blank: '  ', number: 1 };
    expect(readString(source, 'name')).toBe('value');
    expect(readString(source, 'blank')).toBeNull();
    expect(readString(source, 'number')).toBeNull();
    expect(readString(undefined, 'name')).toBeNull();
  });

  it('reads only nested objects', () => {
    const source = { nested: { a: 1 }, list: [1], text: 'x' };
    expect(readObject(source, 'nested')).toEqual({ a: 1 });
    expect(readObject(source, 'list')).toBeNull();
    expect(readObject(source, 'text')).toBeNull();
  });
});

describe('decodeJwtClaims', () => {
  it('reads the payload segment', () => {
    const payload = Buffer.from(
      JSON.stringify({ email: 'you@example.com' }),
    ).toString('base64url');
    expect(decodeJwtClaims(`header.${payload}.signature`)).toEqual({
      email: 'you@example.com',
    });
  });

  it('answers null for anything that is not a decodable JWT', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull();
    expect(decodeJwtClaims('header.not-base64-json.signature')).toBeNull();
  });
});
