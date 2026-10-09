// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  credentialKind,
  looksLikeCredential,
  secretMemberName,
} from './secret-patterns';

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
