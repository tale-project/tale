import { describe, expect, it } from 'vitest';

import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';

import { FORM_FIELD_ERRORS, formFieldErrorMessage } from './field-errors';

describe('localized field-error presentation', () => {
  it.each([
    ['en', enMessages],
    ['de', deMessages],
    ['fr', frMessages],
  ] as const)(
    'provides %s guidance for every shared schema issue',
    (_locale, catalog: { forms: { validation: Record<string, string> } }) => {
      for (const key of Object.values(FORM_FIELD_ERRORS)) {
        const message =
          catalog.forms.validation[key.slice('validation.'.length)];
        expect(typeof message).toBe('string');
        expect(message?.trim().length).toBeGreaterThan(0);
        expect(message).not.toBe(key);
      }
    },
  );

  it('translates an existing issue with the current locale every time it renders', () => {
    const key = FORM_FIELD_ERRORS.nameRequired;
    expect(formFieldErrorMessage(key, () => 'Enter your name.')).toBe(
      'Enter your name.',
    );
    expect(formFieldErrorMessage(key, () => 'Gib deinen Namen ein.')).toBe(
      'Gib deinen Namen ein.',
    );
    expect(formFieldErrorMessage(key, () => 'Saisis ton nom.')).toBe(
      'Saisis ton nom.',
    );
  });

  it('uses localized guidance for an unexpected resolver issue', () => {
    expect(
      formFieldErrorMessage('Invalid input: expected string', (key) => key),
    ).toBe('validation.invalid');
  });

  it('shows no error before a field has an issue', () => {
    expect(formFieldErrorMessage(undefined, (key) => key)).toBeUndefined();
  });
});
