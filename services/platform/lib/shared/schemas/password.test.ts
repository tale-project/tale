import { describe, expect, it } from 'vitest';

import { DEFAULT_PASSWORD_POLICY } from './governance';
import {
  createOptionalPasswordSchema,
  createPasswordSchema,
  enabledValidationKeys,
  isPasswordValid,
  passwordPolicyViolations,
  validatePassword,
} from './password';

const VALID_PASSWORD = 'Test1234!';
const MESSAGES = {
  minLength: 'min length',
  lowercase: 'lowercase',
  uppercase: 'uppercase',
  number: 'number',
  specialChar: 'special char',
};

const relaxed = {
  ...DEFAULT_PASSWORD_POLICY,
  requireUpper: false,
  requireLower: false,
  requireDigit: false,
  requireSpecial: false,
};

describe('validatePassword (default policy)', () => {
  it('returns all true for a valid password', () => {
    const result = validatePassword(VALID_PASSWORD);
    expect(result).toEqual({
      length: true,
      lowercase: true,
      uppercase: true,
      number: true,
      specialChar: true,
    });
  });

  it('fails length for short password', () => {
    expect(validatePassword('Ab1!').length).toBe(false);
  });

  it('fails lowercase when missing', () => {
    expect(validatePassword('ABCDEFG1!').lowercase).toBe(false);
  });

  it('fails uppercase when missing', () => {
    expect(validatePassword('abcdefg1!').uppercase).toBe(false);
  });

  it('fails number when missing', () => {
    expect(validatePassword('Abcdefgh!').number).toBe(false);
  });

  it('fails special char when missing', () => {
    expect(validatePassword('Abcdefg1').specialChar).toBe(false);
  });

  it('fails all rules for empty string', () => {
    const result = validatePassword('');
    expect(Object.values(result).every((v) => v === false)).toBe(true);
  });
});

describe('validatePassword (custom policy)', () => {
  it('treats disabled rules as passing', () => {
    const result = validatePassword('abcdefgh', relaxed);
    expect(result).toEqual({
      length: true,
      lowercase: true,
      uppercase: true,
      number: true,
      specialChar: true,
    });
  });

  it('enforces custom minLength', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 12 };
    expect(validatePassword('Test1234!', policy).length).toBe(false);
    expect(validatePassword('Test1234!abcd', policy).length).toBe(true);
  });
});

describe('isPasswordValid', () => {
  it('returns true for valid password under default policy', () => {
    expect(isPasswordValid(VALID_PASSWORD)).toBe(true);
  });

  it('returns false when any rule fails', () => {
    expect(isPasswordValid('short1!')).toBe(false);
    expect(isPasswordValid('alllowercase1!')).toBe(false);
    expect(isPasswordValid('ALLUPPERCASE1!')).toBe(false);
    expect(isPasswordValid('NoNumbers!!')).toBe(false);
    expect(isPasswordValid('NoSpecial1a')).toBe(false);
  });

  it('accepts under a relaxed policy', () => {
    expect(isPasswordValid('abcdefgh', relaxed)).toBe(true);
  });
});

describe('enabledValidationKeys', () => {
  it('always includes length', () => {
    expect(enabledValidationKeys(relaxed)).toEqual(['length']);
  });

  it('includes every enabled class under default policy', () => {
    expect(enabledValidationKeys()).toEqual([
      'length',
      'lowercase',
      'uppercase',
      'number',
      'specialChar',
    ]);
  });
});

describe('passwordPolicyViolations', () => {
  it('returns empty for a valid password', () => {
    expect(passwordPolicyViolations(VALID_PASSWORD)).toEqual([]);
  });

  it('lists every failing rule', () => {
    expect(passwordPolicyViolations('abc').sort()).toEqual(
      ['length', 'number', 'specialChar', 'uppercase'].sort(),
    );
  });
});

describe('createPasswordSchema', () => {
  const schema = createPasswordSchema(MESSAGES);

  it('accepts a valid password', () => {
    expect(schema.safeParse(VALID_PASSWORD).success).toBe(true);
  });

  it('rejects password too short', () => {
    const result = schema.safeParse('Ab1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('min length');
    }
  });

  it('rejects password missing lowercase', () => {
    const result = schema.safeParse('ABCDEFG1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('lowercase');
    }
  });

  it('omits regex steps for disabled rules', () => {
    const relaxedSchema = createPasswordSchema(MESSAGES, relaxed);
    expect(relaxedSchema.safeParse('abcdefgh').success).toBe(true);
    expect(relaxedSchema.safeParse('short').success).toBe(false);
  });
});

describe('createOptionalPasswordSchema', () => {
  const schema = createOptionalPasswordSchema(MESSAGES);

  it('accepts undefined and empty string', () => {
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse('').success).toBe(true);
  });

  it('accepts a valid password', () => {
    expect(schema.safeParse(VALID_PASSWORD).success).toBe(true);
  });

  it('rejects an invalid non-empty password', () => {
    expect(schema.safeParse('weak').success).toBe(false);
  });

  it('respects custom policy', () => {
    const relaxedSchema = createOptionalPasswordSchema(MESSAGES, relaxed);
    expect(relaxedSchema.safeParse('abcdefgh').success).toBe(true);
  });
});
