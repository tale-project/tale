import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeIdTokenPayload } from './id_token';

function jwt(
  payload: unknown,
  encoding: 'base64url' | 'base64' = 'base64url',
): string {
  const header = Buffer.from('{"alg":"RS256","typ":"JWT"}').toString(encoding);
  const body = Buffer.from(JSON.stringify(payload)).toString(encoding);
  return `${header}.${body}.signature`;
}

describe('decodeIdTokenPayload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('decodes a base64url payload, including the two characters plain base64 lacks', () => {
    // `>>>` and `"??` sit on 3-byte boundaries and encode to `Pj4-` / `Ij8_`;
    // the fixture must carry both url-alphabet characters or it proves
    // nothing about the alphabet.
    const token = jwt({ n: '>>>', m: '???', roles: ['Administrator'] });
    const segment = token.split('.')[1] ?? '';
    expect(segment).toMatch(/-/);
    expect(segment).toMatch(/_/);

    expect(decodeIdTokenPayload(token)).toEqual({
      n: '>>>',
      m: '???',
      roles: ['Administrator'],
    });
  });

  it('keeps non-ASCII claim text intact', () => {
    expect(decodeIdTokenPayload(jwt({ name: 'Jürgen Müller' }))).toEqual({
      name: 'Jürgen Müller',
    });
  });

  it('accepts a padded standard-base64 payload as well', () => {
    expect(decodeIdTokenPayload(jwt({ sub: 'x' }, 'base64'))).toEqual({
      sub: 'x',
    });
  });

  it('answers undefined for anything that is not a JWT with an object payload', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segment = (json: string): string =>
      Buffer.from(json).toString('base64url');

    expect(decodeIdTokenPayload('')).toBeUndefined();
    expect(decodeIdTokenPayload('not-a-jwt')).toBeUndefined();
    expect(decodeIdTokenPayload('a.b')).toBeUndefined();
    expect(decodeIdTokenPayload('a..c')).toBeUndefined();
    expect(decodeIdTokenPayload('h.!!!.s')).toBeUndefined();
    expect(
      decodeIdTokenPayload(`h.${segment('"just a string"')}.s`),
    ).toBeUndefined();
    expect(decodeIdTokenPayload(`h.${segment('[1,2]')}.s`)).toBeUndefined();
  });
});
