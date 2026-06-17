import { describe, expect, it } from 'vitest';

import { scanFileForSecrets } from './secret_scanner';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('scanFileForSecrets', () => {
  it('allows ordinary file content', () => {
    const result = scanFileForSecrets(
      enc('# README\n\nThis is a perfectly ordinary document.'),
    );
    expect(result.rejected).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('rejects an AWS access key', () => {
    const result = scanFileForSecrets(enc('aws_key = AKIAIOSFODNN7EXAMPLE'));
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('AWS Access Key');
  });

  it('rejects a PEM private key', () => {
    const result = scanFileForSecrets(
      enc(
        // nosemgrep: tools.opengrep.ts-no-private-key-literal -- fake fixture for the scanner under test
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----',
      ),
    );
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('Private Key');
  });

  it('rejects an OpenSSH private key header', () => {
    const result = scanFileForSecrets(
      enc(
        // nosemgrep: tools.opengrep.ts-no-private-key-literal -- fake fixture for the scanner under test
        '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      ),
    );
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('Private Key');
  });

  it('rejects a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = scanFileForSecrets(enc(`token: ${jwt}`));
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('JSON Web Token');
  });

  it('rejects a high-entropy secret assigned to a key-shaped name', () => {
    const result = scanFileForSecrets(
      enc("api_key = 'a1b2c3d4e5f6a7b8c9d0e1f2'"),
    );
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain('Secret Keyword');
  });

  it('allows placeholder secret values', () => {
    expect(
      scanFileForSecrets(enc('api_key = "your-api-key-here"')).rejected,
    ).toBe(false);
    expect(scanFileForSecrets(enc('password = changeme')).rejected).toBe(false);
    expect(scanFileForSecrets(enc('secret = REDACTED')).rejected).toBe(false);
  });

  it('allows a member-access reference, not a literal', () => {
    expect(
      scanFileForSecrets(enc('apiKey = config.secrets.apiKey')).rejected,
    ).toBe(false);
    expect(
      scanFileForSecrets(enc('token = process.env.AUTH_TOKEN')).rejected,
    ).toBe(false);
  });

  it('allows a templated value', () => {
    expect(
      scanFileForSecrets(enc('api_key = ${process.env.API_KEY}')).rejected,
    ).toBe(false);
  });

  it('allows a masked value', () => {
    expect(scanFileForSecrets(enc('password = ********')).rejected).toBe(false);
  });

  it('allows short values assigned to a key-shaped name', () => {
    expect(scanFileForSecrets(enc('token = abc123')).rejected).toBe(false);
  });

  it('fails open on undecodable bytes (allows the file)', () => {
    const result = scanFileForSecrets(new Uint8Array([0xff, 0xfe, 0x00, 0x01]));
    expect(result.rejected).toBe(false);
  });
});
