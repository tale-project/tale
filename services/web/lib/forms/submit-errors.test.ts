import { describe, expect, test } from 'vitest';

import {
  FORM_NOT_CONFIGURED_CODE,
  formSubmitErrorMessage,
} from './submit-errors';

describe('formSubmitErrorMessage', () => {
  const t = (key: string) => key;

  test('maps 429 to rateLimited', () => {
    expect(formSubmitErrorMessage(429, t)).toBe('errors.rateLimited');
  });

  test('maps 503 + not_configured to the permanent notConfigured message', () => {
    expect(formSubmitErrorMessage(503, t, FORM_NOT_CONFIGURED_CODE)).toBe(
      'errors.notConfigured',
    );
  });

  test('maps 5xx (incl. proxy 503 without the code) to serverUnavailable', () => {
    expect(formSubmitErrorMessage(500, t)).toBe('errors.serverUnavailable');
    expect(formSubmitErrorMessage(503, t)).toBe('errors.serverUnavailable');
    expect(formSubmitErrorMessage(502, t)).toBe('errors.serverUnavailable');
  });

  test('maps other errors to generic', () => {
    expect(formSubmitErrorMessage(400, t)).toBe('errors.generic');
    expect(formSubmitErrorMessage(0, t)).toBe('errors.generic');
  });
});
