import { describe, expect, it } from 'vitest';

import { findSecrets } from './secret-scan';

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
