import { describe, expect, test } from 'bun:test';

import { redactAdminKey } from './reseed-all-orgs';

describe('redactAdminKey', () => {
  test('redacts the dashboard banner line', () => {
    const input = '   Admin Key:      sk_abcdef1234567890+/=';
    expect(redactAdminKey(input)).toBe('   Admin Key: <redacted>');
  });

  test('matches case-insensitively', () => {
    const lower = 'admin key: 1234567890abcdef';
    expect(redactAdminKey(lower)).toBe('admin key: <redacted>');
  });

  test('redacts even without leading whitespace', () => {
    const input = 'Admin Key: AKIAIOSFODNN7EXAMPLEKEY';
    expect(redactAdminKey(input)).toBe('Admin Key: <redacted>');
  });

  test('redacts when colon is missing', () => {
    const input = 'Admin Key     AKIAIOSFODNN7EXAMPLEKEY';
    expect(redactAdminKey(input)).toBe('Admin Key: <redacted>');
  });

  test('redacts multiple occurrences in the same stream', () => {
    const input = [
      'Setting up...',
      '   Admin Key:      sk_first_key_1234567890',
      'Done. Admin Key: sk_second_key_abcdef1234',
    ].join('\n');
    const out = redactAdminKey(input);
    expect(out).not.toContain('sk_first_key');
    expect(out).not.toContain('sk_second_key');
    expect(out.match(/<redacted>/g)?.length).toBe(2);
  });

  test('leaves non-admin-key text alone', () => {
    const input = [
      'Reseeded 5/5 orgs from builtin catalog.',
      'Per-org status:',
      '  - default: ok',
    ].join('\n');
    expect(redactAdminKey(input)).toBe(input);
  });

  test('does not redact short tokens (avoids false positives)', () => {
    // The 12-char minimum stops common patterns like `Admin key: ok` or
    // `Admin Key: TBD` from being scrubbed and looking suspicious.
    const input = 'Admin Key: TBD';
    expect(redactAdminKey(input)).toBe('Admin Key: TBD');
  });
});
