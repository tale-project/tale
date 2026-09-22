import { describe, expect, it } from 'vitest';

import { contactCreateSchema, contactPhoneSchema } from './input-schema.ts';

describe('contactPhoneSchema', () => {
  it.each(['+1-555-0100', '+49 30 123456', '(020) 7946 0958', '0044123456789'])(
    'accepts %s',
    (phone) => {
      expect(contactPhoneSchema.parse(phone)).toBe(phone);
    },
  );

  it.each(['00kkkk', 'call me', '+1-555-ABCD', '++'])('rejects %s', (phone) => {
    expect(() => contactPhoneSchema.parse(phone)).toThrow();
  });
});

describe('contactCreateSchema phone', () => {
  it('accepts a create with a well-formed phone', () => {
    expect(
      contactCreateSchema.parse({
        email: 'ada@example.com',
        phone: '+1 555 0100',
      }),
    ).toMatchObject({ phone: '+1 555 0100' });
  });

  it('rejects a create whose phone contains letters', () => {
    expect(
      contactCreateSchema.safeParse({
        email: 'ada@example.com',
        phone: '00kkkk',
      }).success,
    ).toBe(false);
  });
});
