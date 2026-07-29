import { describe, expect, it } from 'vitest';

import { isPlaceholder, scanForSecrets } from './secret-scan';

/**
 * A scanner is judged by both of its error modes. Missing a credential means it
 * gets indexed and eventually read back into a model's context; flagging
 * documentation means people cannot upload their own runbooks. So the refusals
 * and the acceptances are tested with equal weight — and the fail-open
 * behaviour is tested too, because a scanner bug must not become an outage.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('credentials are refused', () => {
  const secrets: Array<[string, string, string]> = [
    [
      'an AWS access key id',
      'aws_key = AKIAIOSFODNN7EXAMPLE\n',
      'AWS access key',
    ],
    [
      'a PEM private key block',
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- truncated fake fixture the scanner must flag, not a real key
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n',
      'private key',
    ],
    [
      'an OpenSSH private key block',
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- truncated fake fixture the scanner must flag, not a real key
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz...\n',
      'private key',
    ],
    [
      'a JSON Web Token',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.7Hs_lTaSignature\n',
      'JSON Web Token',
    ],
    [
      'a long hex literal assigned to an api key',
      'api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n',
      'secret keyword',
    ],
    [
      'a high-entropy token assigned to a password',
      'password: xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n',
      'secret keyword',
    ],
  ];

  it.each(secrets)('refuses %s', (_name, content, kind) => {
    const result = scanForSecrets(bytes(content));
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain(kind);
  });

  it('never puts the value in the reason', () => {
    // The reason is shown to a user and written to a log; both are places the
    // secret must not end up.
    const secret = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const result = scanForSecrets(bytes(`api_key = "${secret}"`));
    expect(result.rejected).toBe(true);
    expect(result.reason).not.toContain(secret);
  });
});

describe('documentation is not a credential', () => {
  const allowed: Array<[string, string]> = [
    ['a placeholder', 'api_key = "your-api-key-here"\n'],
    ['a masked value', 'password: ********\n'],
    ['an environment reference', 'token = ${env.SERVICE_TOKEN}\n'],
    ['a template hole', 'secret: {{ vault.password }}\n'],
    ['a member access', 'const key = config.apiKey;\n'],
    ['an angle-bracket stand-in', 'auth: <your token>\n'],
    ['a short value', 'password: hunter2\n'],
    ['a prose sentence about keys', 'Rotate the api key every 90 days.\n'],
    ['an English word assigned to a token', 'token: production\n'],
    ['a plain document', 'Parental leave is 16 weeks for both parents.\n'],
    ['a lookalike identifier', 'api_key = AKIA_NOT_A_REAL_KEY\n'],
  ];

  it.each(allowed)('allows %s', (_name, content) => {
    expect(scanForSecrets(bytes(content))).toEqual({
      rejected: false,
      reason: null,
    });
  });

  it('allows an empty file', () => {
    expect(scanForSecrets(new Uint8Array())).toEqual({
      rejected: false,
      reason: null,
    });
  });

  it('allows binary content it cannot read as text', () => {
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0x90]);
    expect(scanForSecrets(binary).rejected).toBe(false);
  });
});

describe('placeholder recognition', () => {
  it.each([
    'REDACTED',
    'changeme',
    '***',
    'your_secret_here',
    'example-token',
    'process.env.API_KEY',
    '${SECRET}',
    '<token>',
    '',
  ])('treats %s as a placeholder', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it.each(['0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'xQ7vZk93Lp2Rt8WbNc4Ye6'])(
    'does not treat %s as a placeholder',
    (value) => {
      expect(isPlaceholder(value)).toBe(false);
    },
  );
});
