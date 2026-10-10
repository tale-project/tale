// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { credentialKind } from '../../shared/secret-scan';
import { looksLikeCredential, secretMemberName } from './secret-patterns';

describe('secretMemberName', () => {
  it.each([
    ['password', 'strong'],
    ['userPassword', 'strong'],
    ['api-key', 'strong'],
    ['x-api-key', 'strong'],
    ['client_secret', 'strong'],
    ['Authorization', 'strong'],
    ['set-cookie', 'strong'],
    ['pin', 'strong'],
    ['token', 'strong'],
    ['access_token', 'strong'],
    ['totpCode', 'strong'],
    ['nextPageToken', 'weak'],
    ['tokenId', 'weak'],
    ['inputTokens', undefined],
    ['max_tokens', undefined],
    ['tokenizer', undefined],
    ['prompt_tokens_details', undefined],
    ['author', undefined],
    ['title', undefined],
  ] as const)('%s reads %s', (name, kind) => {
    expect(secretMemberName(name)).toBe(kind);
  });
});

describe('the document check and the recorder', () => {
  it('leave a templated URL alone', () => {
    const url = 'https://{{ input.user }}:{{ input.pass }}@example.com';
    expect(credentialKind(url)).toBeUndefined();
    expect(looksLikeCredential(url)).toBe(false);
  });

  it('refuse in a document only what the document check always refused', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl';
    expect(credentialKind(jwt)).toBeUndefined();
    expect(looksLikeCredential(jwt)).toBe(true);
    expect(credentialKind(`ghp_${'a'.repeat(30)}`)).toBe('GitHub token');
  });

  it('leave prose alone', () => {
    for (const text of [
      'Please reset your password tomorrow.',
      'The token count was 1200.',
      'See https://example.com/docs?page=2',
    ]) {
      expect(looksLikeCredential(text), text).toBe(false);
    }
  });
});

// REGRESSION: two of the recorder's shapes scanned a long run of token
// characters once per place a match could start there — quadratic, about
// nine seconds for 128 KB — and they run on whatever a run receives, a
// webhook body included, in the API process.
describe('the recorder reads any text in linear time', () => {
  const quarterMegabyte = 256 * 1024;
  it.each([
    ['a word boundary every other character', 'a-'],
    ['a token start every four characters', 'eyJ-'],
    ['a scheme-like run', 'a+'],
    ['a dotted token-like run', 'eyJabc.'],
  ])('reads 256 KB with %s quickly', (_shape, unit) => {
    const text = unit.repeat(Math.ceil(quarterMegabyte / unit.length));
    const started = performance.now();
    looksLikeCredential(text);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('still finds a web token and a password in a URL, after a long run', () => {
    const run = 'a-'.repeat(50_000);
    expect(
      looksLikeCredential(
        `${run} Bearer-less eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl`,
      ),
    ).toBe(true);
    expect(
      looksLikeCredential(`${run} postgres://admin:hunter22@db.internal/app`),
    ).toBe(true);
  });
});
