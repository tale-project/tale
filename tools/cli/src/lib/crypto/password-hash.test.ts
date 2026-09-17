import { describe, expect, test } from 'bun:test';

import { hashPassword, verifyPassword } from 'better-auth/crypto';

import {
  hashAccountPassword,
  passwordHashSchema,
  passwordPolicyFailures,
} from './password-hash';

const password = 'Synthetic!Break-Glass1';

describe('Better Auth credential hashes', () => {
  test('the platform verifies the hash exactly as it verifies its own', async () => {
    const hash = await hashAccountPassword(password);
    expect(passwordHashSchema.safeParse(hash).success).toBe(true);
    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(await verifyPassword({ hash, password: `${password}!` })).toBe(
      false,
    );
    // Salted: the same password never yields the same stored credential.
    expect(await hashAccountPassword(password)).not.toBe(hash);
    expect(
      passwordHashSchema.safeParse(await hashPassword(password)).success,
    ).toBe(true);
  });

  test.each([
    ['uppercase hex', `${'A'.repeat(32)}:${'b'.repeat(128)}`],
    ['short salt', `${'a'.repeat(30)}:${'b'.repeat(128)}`],
    ['short key', `${'a'.repeat(32)}:${'b'.repeat(126)}`],
    ['long key', `${'a'.repeat(32)}:${'b'.repeat(130)}`],
    ['no separator', 'a'.repeat(161)],
    ['trailing line ending', `${'a'.repeat(32)}:${'b'.repeat(128)}\n`],
    ['leading space', ` ${'a'.repeat(32)}:${'b'.repeat(128)}`],
    ['another format', `$2b$12$${'a'.repeat(53)}`],
    ['plaintext', password],
  ])('refuses %s', (_name, value) => {
    expect(passwordHashSchema.safeParse(value).success).toBe(false);
  });

  test('names the failed default policy rules', () => {
    expect(passwordPolicyFailures('short')).toEqual([
      'length',
      'uppercase',
      'number',
      'specialChar',
    ]);
    expect(passwordPolicyFailures(password)).toEqual([]);
  });
});
