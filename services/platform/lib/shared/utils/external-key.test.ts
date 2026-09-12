import { describe, expect, it } from 'vitest';

import { canonicalExternalKey, externalKeySchema } from './external-key.ts';

describe('canonicalExternalKey', () => {
  it('composes to NFC and trims surrounding whitespace', () => {
    const nfd = 'acme-café'.normalize('NFD');
    expect(nfd).not.toBe('acme-café');
    expect(canonicalExternalKey(`  ${nfd}\n`)).toBe('acme-café');
    expect(canonicalExternalKey('acme-café')).toBe('acme-café');
  });

  it('leaves interior whitespace and case alone', () => {
    expect(canonicalExternalKey(' CRM 4711 ')).toBe('CRM 4711');
  });
});

describe('externalKeySchema', () => {
  const schema = externalKeySchema(8);

  it('answers the canonical form', () => {
    expect(schema.parse(' éx ')).toBe('éx');
  });

  it('refuses a key that is blank once canonicalized, by name', () => {
    const result = schema.safeParse('   ');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('must not be blank');
  });

  it('bounds the canonical form, not the padded one', () => {
    expect(schema.safeParse('   12345678   ').success).toBe(true);
    expect(schema.safeParse('123456789').success).toBe(false);
  });
});
