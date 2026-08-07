import { describe, expect, it, vi } from 'vitest';

import {
  turnErrorToastDescription,
  turnRefusalToastContent,
  turnNamedFailureToastContent,
} from './turn-error-toast';

describe('turnErrorToastDescription', () => {
  const t = vi.fn((key: string) => key);

  it('returns a localized hint for provider auth failures instead of raw JSON', () => {
    const description = turnErrorToastDescription(
      'The model provider answered 401: {"type":"error","error":{"type":"authentication_error","message":"invalid key"}}',
      t,
    );
    expect(description).toBe('errorHintAuthError');
    expect(t).toHaveBeenCalledWith('errorHintAuthError', undefined);
  });

  it('returns undefined for an empty reason', () => {
    expect(turnErrorToastDescription(undefined, t)).toBeUndefined();
    expect(turnErrorToastDescription('', t)).toBeUndefined();
  });

  it('falls back to a cleaned raw line for generic failures', () => {
    const description = turnErrorToastDescription(
      'Something unexpected happened.',
      t,
    );
    expect(description).toBe('Something unexpected happened.');
  });
});

describe('turnRefusalToastContent', () => {
  const t = vi.fn((key: string) => key);

  it('maps a guardrail refusal to its title without a raw description', () => {
    const content = turnRefusalToastContent('Message blocked: PII detected', t);
    expect(content.titleKey).toBe('toast.piiBlocked');
    expect(content.description).toBeUndefined();
  });

  it('maps a provider auth failure to a sanitized send description', () => {
    const content = turnRefusalToastContent(
      'The model provider answered 401: {"type":"error"}',
      t,
    );
    expect(content.titleKey).toBe('toast.sendFailed');
    expect(content.description).toBe('errorHintAuthError');
  });
});

describe('turnNamedFailureToastContent', () => {
  const t = vi.fn((key: string) => key);

  it('keeps the caller title and sanitizes the description', () => {
    const content = turnNamedFailureToastContent(
      'The model provider answered 401: {"type":"error"}',
      'regenerateFailed',
      t,
    );
    expect(content.titleKey).toBe('regenerateFailed');
    expect(content.description).toBe('errorHintAuthError');
  });
});
