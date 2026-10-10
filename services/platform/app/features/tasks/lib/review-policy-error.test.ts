import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { reviewPolicyErrorMessage } from './review-policy-error';

describe('reviewPolicyErrorMessage', () => {
  it.each([
    [
      'en',
      'Review policy could not be read. Restore valid organization policy before deciding.',
    ],
    [
      'de',
      'Die Prüfrichtlinie konnte nicht gelesen werden. Stelle eine gültige Organisationsrichtlinie wieder her, bevor die Prüfung entschieden wird.',
    ],
    [
      'fr',
      'La politique de relecture n’a pas pu être lue. Rétablis une politique d’organisation valide avant toute décision.',
    ],
  ])('explains an unavailable organization policy in %s', (locale, message) => {
    expect(
      reviewPolicyErrorMessage(
        new AppError({
          code: 'TASK_REVIEW_POLICY_UNAVAILABLE',
          message: 'Backend refusal text',
        }),
        i18n.getFixedT(locale, 'tasks'),
      ),
    ).toBe(message);
  });

  it.each([
    ['TASK_AGENT_REVIEW_REQUIRED', 'reviewer.agentRequired'],
    [
      'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
      'review.independentReviewerRequired',
    ],
    ['REVIEW_COMPETENCE_REQUIRED', 'review.competenceRequired'],
  ])('retains the existing %s refusal', (code, key) => {
    expect(
      reviewPolicyErrorMessage(new AppError({ code }), (value) => value),
    ).toBe(key);
  });

  it('leaves unrelated errors to their existing reporter', () => {
    expect(
      reviewPolicyErrorMessage(
        new AppError({ code: 'TASK_NOT_FOUND' }),
        (key) => key,
      ),
    ).toBeUndefined();
    expect(
      reviewPolicyErrorMessage(new Error('offline'), (key) => key),
    ).toBeUndefined();
  });
});
