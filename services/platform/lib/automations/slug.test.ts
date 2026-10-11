import { describe, expect, it } from 'vitest';

import {
  automationSlugToParam,
  generatedAutomationSlug,
  paramToAutomationSlug,
  slugFromName,
} from './slug';

describe('an automation name in a URL', () => {
  it('travels as one segment and back', () => {
    expect(automationSlugToParam('billing/dunning-reminder')).toBe(
      'billing__dunning-reminder',
    );
    expect(paramToAutomationSlug('billing__dunning-reminder')).toBe(
      'billing/dunning-reminder',
    );
  });
});

describe('the name a typed name gives an automation', () => {
  it.each([
    ['Triage new tasks', 'triage-new-tasks'],
    ['  Résumé du jour!  ', 'resume-du-jour'],
    ['Größe prüfen', 'grosse-prufen'],
    ['Prévenir le relecteur', 'prevenir-le-relecteur'],
    ['发票提醒', ''],
    ['x'.repeat(70), 'x'.repeat(64)],
  ])('reads %j as %j', (typed, slug) => {
    expect(slugFromName(typed)).toBe(slug);
  });

  it('stands in with a generated name for a name it cannot keep', () => {
    expect(generatedAutomationSlug()).toMatch(/^automation-[0-9a-f]{8}$/);
  });
});
