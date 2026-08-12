import { describe, expect, it } from 'vitest';

import {
  builderOutcomeBodyText,
  builderOutcomeVariant,
  builderShowsTechnicalDetails,
  classifyBuilderFailureCode,
  isBuilderHardFailure,
  sanitizeBuilderReason,
} from './builder-error-display';

describe('sanitizeBuilderReason', () => {
  it('classifies an auth failure and names the provider from the reason', () => {
    const sanitized = sanitizeBuilderReason(
      'the model call failed: anthropic answered 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    );
    expect(sanitized.code).toBe('auth_error');
    expect(sanitized.i18nKey).toBe('errorHintAuthErrorNamed');
    expect(sanitized.params).toEqual({ provider: 'anthropic' });
  });

  it('prefers the selected provider slug over parsing the reason', () => {
    const sanitized = sanitizeBuilderReason(
      'the model call failed: upstream 401 invalid key',
      'openrouter',
    );
    expect(sanitized.code).toBe('auth_error');
    expect(sanitized.params).toEqual({ provider: 'openrouter' });
  });

  it('strips the builder model-call prefix before classifying', () => {
    expect(
      classifyBuilderFailureCode(
        'the model call failed: anthropic answered 503: overloaded',
      ),
    ).toBe('provider_error');
  });
});

describe('builder outcome presentation', () => {
  const tChat = (key: string) => key;

  it('treats auth failures as destructive hard failures', () => {
    expect(isBuilderHardFailure('auth_error')).toBe(true);
    expect(builderOutcomeVariant('auth_error', 'gave-up')).toBe('destructive');
  });

  it('treats soft give-ups as warnings', () => {
    expect(builderOutcomeVariant('generic', 'gave-up')).toBe('warning');
  });

  it('shows the server reason for generic give-ups', () => {
    const sanitized = sanitizeBuilderReason('the tests never passed');
    const body = builderOutcomeBodyText(
      sanitized,
      'the tests never passed',
      tChat,
    );
    expect(body).toBe('the tests never passed');
    expect(builderShowsTechnicalDetails(sanitized, body)).toBe(false);
  });

  it('keeps technical details separate from the localized auth hint', () => {
    const reason =
      'the model call failed: anthropic answered 401: {"type":"error"}';
    const sanitized = sanitizeBuilderReason(reason);
    const body = builderOutcomeBodyText(sanitized, reason, tChat);
    expect(body).toBe('errorHintAuthErrorNamed');
    expect(builderShowsTechnicalDetails(sanitized, body)).toBe(true);
    expect(sanitized.rawMessage).toContain('anthropic answered 401');
  });
});
