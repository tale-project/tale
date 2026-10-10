import { describe, expect, it } from 'vitest';

import {
  credentialKind,
  findSecrets,
  findWithheld,
  looksLikeCredential,
  secretMemberName,
  withholdSecrets,
} from './secret-scan';

/** Obviously fake credentials, one per shape the detector knows (the key
 * header is assembled so no scanner reads this file as holding one). */
const FAKE = {
  openai: 'sk-000000000000000000000000',
  aws: 'AKIA0000000000000000',
  slack: 'xoxb-0000000000-0000000000',
  github: 'ghp_000000000000000000000000',
  key: ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
  bearer: 'Bearer 000000000000000000000000',
};

describe('findSecrets', () => {
  it('names the kind of every known credential shape, wherever it sits in a string', () => {
    expect(
      Object.values(FAKE).map((value) => findSecrets(`note: ${value} end`)),
    ).toEqual([
      [{ path: '', pointer: '', label: 'API key (sk-…)' }],
      [{ path: '', pointer: '', label: 'AWS access key' }],
      [{ path: '', pointer: '', label: 'Slack token' }],
      [{ path: '', pointer: '', label: 'GitHub token' }],
      [{ path: '', pointer: '', label: 'private key material' }],
      [{ path: '', pointer: '', label: 'bearer token' }],
    ]);
  });

  it('reads an opaque word as a credential only under a member named like one', () => {
    const opaque = 'Zm9vYmFyYmF6cXV4cXV1eA';
    expect(findSecrets({ apiKey: opaque, password: opaque })).toEqual([
      {
        path: 'apiKey',
        pointer: '/apiKey',
        label: 'credential-looking value under "apiKey"',
      },
      {
        path: 'password',
        pointer: '/password',
        label: 'credential-looking value under "password"',
      },
    ]);
    // The same word under another name, in a list, or with spaces is not.
    expect(
      findSecrets({
        description: opaque,
        token: [opaque],
        secret: 'two words here and more',
        authorization: 'Bearer {{secret.moderation}}',
      }),
    ).toEqual([]);
  });

  it('locates a hit by dotted path and by escaped pointer', () => {
    expect(
      findSecrets({
        nodes: [{ config: { 'a/b~c': FAKE.github } }],
      }),
    ).toEqual([
      {
        path: 'nodes[0].config.a/b~c',
        pointer: '/nodes/0/config/a~1b~0c',
        label: 'GitHub token',
      },
    ]);
  });

  it('never carries the value it found', () => {
    const hits = findSecrets({ a: FAKE.openai, b: [FAKE.aws] });
    expect(hits).toHaveLength(2);
    expect(JSON.stringify(hits)).not.toContain(FAKE.openai);
    expect(JSON.stringify(hits)).not.toContain(FAKE.aws);
  });

  it('counts one hit per string, and none in a value with no strings', () => {
    expect(findSecrets(`${FAKE.openai} ${FAKE.bearer}`)).toHaveLength(1);
    expect(findSecrets({ n: 1, ok: true, none: null })).toEqual([]);
  });
});

describe('secretMemberName', () => {
  it.each([
    ['password', 'strong'],
    ['userPassword', 'strong'],
    ['api-key', 'strong'],
    ['x-api-key', 'strong'],
    ['Ocp-Apim-Subscription-Key', 'strong'],
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

describe('withholdSecrets', () => {
  it('withholds by name, by text and by a member named like a credential, listing each place', () => {
    const places: Array<{ pointer: string; why: string }> = [];
    const out = withholdSecrets(
      {
        user: 'ada',
        password: 'hunter2',
        pin: 1234,
        nextPageToken: 'abc',
        usage: { inputTokens: 12 },
        notes: [`call with ${FAKE.github}`, 'nothing here'],
        [`${FAKE.openai}`]: 'left out',
        flag: true,
      },
      ({ pointer, why }) => places.push({ pointer, why }),
    );
    expect(out).toEqual({
      user: 'ada',
      password: null,
      pin: null,
      nextPageToken: null,
      usage: { inputTokens: 12 },
      notes: [null, 'nothing here'],
      flag: true,
    });
    expect(places).toEqual([
      { pointer: '/password', why: 'key' },
      { pointer: '/pin', why: 'key' },
      { pointer: '/nextPageToken', why: 'key' },
      { pointer: '/notes/0', why: 'pattern' },
      { pointer: '', why: 'name' },
    ]);
  });

  it('leaves a text that only names a secret Tale fills in', () => {
    expect(
      findWithheld({
        authorization: 'Bearer {{secret}}',
        'Ocp-Apim-Subscription-Key': '{{ secret.moderation }}',
        password: 'Bearer hunter2',
      }),
    ).toEqual([
      { pointer: '/password', why: 'key', label: 'a secret under "password"' },
    ]);
  });

  it('judges a member a schema declares by its text alone', () => {
    const declaredNames = new Set(['credentialId', 'auth']);
    const config = {
      credentialId: 'c2f5e0b4-5d0e-4c3c-9f4e-2f1d0b9a7e61',
      auth: [{ method: 'env' }],
      headers: { 'x-api-key': '0123456789abcdef0123456789abcdef' },
    };
    expect(findWithheld(config, { declaredNames })).toEqual([
      {
        pointer: '/headers/x-api-key',
        why: 'key',
        label: 'a secret under "x-api-key"',
      },
    ]);
    expect(
      findWithheld({ credentialId: FAKE.github }, { declaredNames }),
    ).toEqual([
      { pointer: '/credentialId', why: 'pattern', label: 'GitHub token' },
    ]);
  });

  it('keeps a member named __proto__ as a member of its own', () => {
    const value = JSON.parse('{"__proto__": {"password": "x"}, "a": 1}');
    const out = withholdSecrets(value, () => undefined);
    expect(Object.hasOwn(out as object, '__proto__')).toBe(true);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"password":null},"a":1}');
  });
});
