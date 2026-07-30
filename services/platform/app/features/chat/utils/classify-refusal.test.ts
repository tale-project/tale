import { describe, expect, it } from 'vitest';

import { classifyRefusal } from './classify-refusal';

describe('classifyRefusal', () => {
  it('maps a PII block to its own title and keeps the server reason', () => {
    const result = classifyRefusal('Message blocked: PII detected');
    expect(result.titleKey).toBe('toast.piiBlocked');
    expect(result.serverReason).toBe('Message blocked: PII detected');
  });

  it('maps guardrail blocks to the policy title', () => {
    expect(classifyRefusal('Message blocked: chat filter').titleKey).toBe(
      'toast.policyViolation',
    );
    expect(classifyRefusal('Blocked by moderation provider').titleKey).toBe(
      'toast.policyViolation',
    );
  });

  it('maps budget stops', () => {
    expect(classifyRefusal('Your usage limit has been reached').titleKey).toBe(
      'toast.budgetExceeded',
    );
  });

  it('maps model-access denials', () => {
    expect(
      classifyRefusal('You do not have access to the selected model').titleKey,
    ).toBe('toast.modelAccessDenied');
  });

  it('maps a dead thread to the not-found title', () => {
    expect(classifyRefusal('This conversation does not exist.').titleKey).toBe(
      'notFound',
    );
  });

  it('falls back to the generic title with the reason as description', () => {
    const result = classifyRefusal('The upstream is on fire');
    expect(result.titleKey).toBe('toast.sendFailed');
    expect(result.serverReason).toBe('The upstream is on fire');
  });

  it('handles an absent reason', () => {
    expect(classifyRefusal(undefined)).toEqual({
      titleKey: 'toast.sendFailed',
    });
  });
});
