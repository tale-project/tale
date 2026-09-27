import { describe, expect, it, vi } from 'vitest';

import {
  regenerateFailureToastContent,
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

  it('describes a budget refusal with its localized hint, never the English sentence', () => {
    const content = turnRefusalToastContent(
      'Usage limit reached. Your daily request limit is used up until 2026-09-16T00:00:00.000Z.',
      t,
      'BUDGET_EXCEEDED',
    );
    expect(content).toEqual({
      titleKey: 'toast.budgetExceeded',
      description: 'errorHintBudgetExceeded',
    });
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

/**
 * A regenerate whose REQUEST the door refused used to toast a bare "Couldn't
 * regenerate": the door's own words were dropped on the way. They are shown
 * now — as they are, since a provider-error reading would misname a
 * platform refusal.
 */
describe('regenerateFailureToastContent', () => {
  const t = vi.fn((key: string) => key);

  it("shows the door's own words for a request it refused", () => {
    expect(
      regenerateFailureToastContent({ reason: 'RBAC_FORBIDDEN' }, t),
    ).toEqual({ titleKey: 'regenerateFailed', description: 'RBAC_FORBIDDEN' });
    // The provider reading would have called this a rejected API key.
    expect(
      turnNamedFailureToastContent('RBAC_FORBIDDEN', 'regenerateFailed', t)
        .description,
    ).toBe('errorHintAuthError');
  });

  it('keeps the bare title when the failed request said nothing', () => {
    expect(regenerateFailureToastContent({}, t)).toEqual({
      titleKey: 'regenerateFailed',
    });
  });

  it("still sanitizes a refused turn's reason", () => {
    expect(
      regenerateFailureToastContent(
        {
          reason: 'The model provider answered 401: {"type":"error"}',
          persisted: false,
        },
        t,
      ),
    ).toEqual({
      titleKey: 'regenerateFailed',
      description: 'errorHintAuthError',
    });
  });
});
