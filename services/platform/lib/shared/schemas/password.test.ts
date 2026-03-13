import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  createOptionalPasswordSchema,
  createPasswordSchema,
  isPasswordValid,
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

describe('validatePassword', () => {
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
    const result = validatePassword('Ab1!');
    expect(result.length).toBe(false);
    expect(result.lowercase).toBe(true);
    expect(result.uppercase).toBe(true);
    expect(result.number).toBe(true);
    expect(result.specialChar).toBe(true);
  });

  it('fails lowercase when missing', () => {
    const result = validatePassword('ABCDEFG1!');
    expect(result.length).toBe(true);
    expect(result.lowercase).toBe(false);
  });

  it('fails uppercase when missing', () => {
    const result = validatePassword('abcdefg1!');
    expect(result.length).toBe(true);
    expect(result.uppercase).toBe(false);
  });

  it('fails number when missing', () => {
    const result = validatePassword('Abcdefgh!');
    expect(result.length).toBe(true);
    expect(result.number).toBe(false);
  });

  it('fails special char when missing', () => {
    const result = validatePassword('Abcdefg1');
    expect(result.length).toBe(true);
    expect(result.specialChar).toBe(false);
  });

  it('fails all rules for empty string', () => {
    const result = validatePassword('');
    expect(Object.values(result).every((v) => v === false)).toBe(true);
  });
});

describe('isPasswordValid', () => {
  it('returns true for valid password', () => {
    expect(isPasswordValid(VALID_PASSWORD)).toBe(true);
  });

  it('returns false when any rule fails', () => {
    expect(isPasswordValid('short1!')).toBe(false);
    expect(isPasswordValid('alllowercase1!')).toBe(false);
    expect(isPasswordValid('ALLUPPERCASE1!')).toBe(false);
    expect(isPasswordValid('NoNumbers!!')).toBe(false);
    expect(isPasswordValid('NoSpecial1a')).toBe(false);
  });
});

describe('PASSWORD_MIN_LENGTH', () => {
  it('is 8', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
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

  it('rejects password missing uppercase', () => {
    const result = schema.safeParse('abcdefg1!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('uppercase');
    }
  });

  it('rejects password missing number', () => {
    const result = schema.safeParse('Abcdefgh!');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('number');
    }
  });

  it('rejects password missing special char', () => {
    const result = schema.safeParse('Abcdefg1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('special char');
    }
  });
});

describe('createOptionalPasswordSchema', () => {
  const schema = createOptionalPasswordSchema(MESSAGES);

  it('accepts undefined', () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('accepts empty string', () => {
    expect(schema.safeParse('').success).toBe(true);
  });

  it('accepts a valid password', () => {
    expect(schema.safeParse(VALID_PASSWORD).success).toBe(true);
  });

  it('rejects an invalid non-empty password', () => {
    const result = schema.safeParse('weak');
    expect(result.success).toBe(false);
  });

  it('rejects password missing only special char', () => {
    const result = schema.safeParse('Abcdefg1');
    expect(result.success).toBe(false);
  });
});
