import { describe, expect, it } from 'vitest';

import { FORM_FIELD_ERRORS } from './field-errors';
import { contactSchema, requestDemoSchema, submitRequest } from './schemas';

const contact = {
  name: 'Ada Example',
  email: 'ada@example.com',
  company: '',
  message: 'A question about deploying Tale.',
  privacy: true,
  startedAt: 0,
  website: '',
};

describe('form validation at the submission boundary', () => {
  it('cleans text before delivery while retaining multiline messages', () => {
    const result = contactSchema.parse({
      ...contact,
      name: '  Ada\u0000 Example  ',
      email: '  ada@example.com  ',
      message: '  First line.\nSecond line.\u0007  ',
    });
    expect(result.name).toBe('Ada Example');
    expect(result.email).toBe('ada@example.com');
    expect(result.message).toBe('First line.\nSecond line.');
  });

  it.each([
    ['name', '', FORM_FIELD_ERRORS.nameRequired],
    ['name', ' \u0000\u0007 ', FORM_FIELD_ERRORS.nameRequired],
    ['name', 'a'.repeat(2001), FORM_FIELD_ERRORS.nameTooLong],
    ['email', '', FORM_FIELD_ERRORS.emailRequired],
    ['email', 'not-an-email', FORM_FIELD_ERRORS.emailInvalid],
    [
      'email',
      `${'a'.repeat(2001)}@example.com`,
      FORM_FIELD_ERRORS.emailTooLong,
    ],
    ['company', 'a'.repeat(2001), FORM_FIELD_ERRORS.companyTooLong],
    ['message', '', FORM_FIELD_ERRORS.messageRequired],
    ['message', '\u0000'.repeat(10), FORM_FIELD_ERRORS.messageRequired],
    ['message', 'too short', FORM_FIELD_ERRORS.messageTooShort],
    ['message', 'a'.repeat(2001), FORM_FIELD_ERRORS.messageTooLong],
  ])(
    'rejects invalid %s with a stable field-specific issue',
    (field, value, key) => {
      const result = contactSchema.safeParse({ ...contact, [field]: value });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.find((issue) => issue.path[0] === field)?.message,
      ).toBe(key);
    },
  );

  it('accepts the documented contact-message length boundaries', () => {
    for (const length of [10, 2000]) {
      expect(
        contactSchema.safeParse({ ...contact, message: 'a'.repeat(length) })
          .success,
      ).toBe(true);
    }
  });

  it.each(['----', '()()', 'abc', '++1234567', '12+34567'])(
    'rejects the malformed optional phone %s',
    (phone) => {
      const result = requestDemoSchema.safeParse({ ...contact, phone });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toBe(
        FORM_FIELD_ERRORS.phoneInvalid,
      );
    },
  );

  it.each(['12', '+1 (2)-3'])(
    'counts digits when rejecting a short phone %s',
    (phone) => {
      const result = requestDemoSchema.safeParse({ ...contact, phone });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toBe(
        FORM_FIELD_ERRORS.phoneTooShort,
      );
    },
  );

  it('limits a phone to 32 characters', () => {
    const result = requestDemoSchema.safeParse({
      ...contact,
      phone: '1'.repeat(33),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      FORM_FIELD_ERRORS.phoneTooLong,
    );
  });

  it.each([undefined, '', '+41 (33) 123-45-67', '033 123 45 67'])(
    'accepts omitted, empty or formatted phone %s',
    (phone) => {
      expect(
        requestDemoSchema.safeParse({ ...contact, phone, message: '' }).success,
      ).toBe(true);
    },
  );

  it.each(['contact', 'request-demo'] as const)(
    'refuses %s submissions without consent',
    (form) => {
      const result = submitRequest.safeParse({
        form,
        payload: { ...contact, privacy: false },
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0]?.message).toBe('privacyRequired');
    },
  );

  it('refuses a forged demo interest before delivery', () => {
    expect(
      submitRequest.safeParse({
        form: 'request-demo',
        payload: { ...contact, interests: ['unsupported'] },
      }).success,
    ).toBe(false);
  });

  it('allows optional demo text to be omitted but enforces its length when present', () => {
    const { message: _message, company: _company, ...required } = contact;
    expect(requestDemoSchema.safeParse(required).success).toBe(true);
    const result = requestDemoSchema.safeParse({
      ...required,
      message: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      FORM_FIELD_ERRORS.messageTooLong,
    );
  });
});
