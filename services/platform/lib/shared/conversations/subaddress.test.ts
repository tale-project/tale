import { describe, expect, it } from 'vitest';

import { baseAddress, normalizedAddress } from './subaddress';

describe('baseAddress', () => {
  it.each([
    ['support+billing@acme.test', 'support@acme.test'],
    ['support@acme.test', 'support@acme.test'],
    // The tag ends at the FIRST `+`: everything after it is the tag.
    ['support+eu+vip@acme.test', 'support@acme.test'],
    [' Support+Billing@ACME.test ', 'support@acme.test'],
    // A `+` in the domain is not a tag.
    ['support@a+b.test', 'support@a+b.test'],
  ])('%s → %s', (address, expected) => {
    expect(baseAddress(address)).toBe(expected);
  });

  it.each(['+billing@acme.test', 'no-at-sign', '@acme.test', 'support@'])(
    'has no base for %s',
    (address) => {
      expect(baseAddress(address)).toBeUndefined();
    },
  );
});

describe('normalizedAddress', () => {
  it('trims and lowercases', () => {
    expect(normalizedAddress('  Hello@Support.Test\t')).toBe(
      'hello@support.test',
    );
  });
});
