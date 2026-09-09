import { describe, expect, it } from 'vitest';

import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '../../../automations/slug';
import { AUTOMATION_NAME_MAX_LENGTH, isValidAutomationName } from './name';

describe('automation names — one grammar for validator, store and URL codec', () => {
  it.each([
    'weather-report',
    'billing/dunning-reminder',
    'ops/greet',
    'a',
    '0-day',
    'sync_mailbox',
    'team/sub/deep-1',
    'x'.repeat(AUTOMATION_NAME_MAX_LENGTH),
  ])('accepts %s', (name) => {
    expect(isValidAutomationName(name)).toBe(true);
  });

  it.each([
    '',
    'My Flow',
    'Billing/dunning',
    'weather report',
    'a.b',
    'a__b',
    'a--b',
    '-a',
    'a-',
    '_a',
    '/a',
    'a/',
    'a//b',
    'a/-b',
    'x'.repeat(AUTOMATION_NAME_MAX_LENGTH + 1),
  ])('rejects %j', (name) => {
    expect(isValidAutomationName(name)).toBe(false);
  });

  it('rejects anything that is not a string', () => {
    for (const value of [42, null, undefined, {}, ['a']]) {
      expect(isValidAutomationName(value)).toBe(false);
    }
  });

  it('every valid name survives the `__` URL codec unchanged', () => {
    for (const name of [
      'billing/dunning-reminder',
      'sync_mailbox',
      'a/b_c/d-e',
    ]) {
      const param = automationSlugToParam(name);
      expect(param).not.toContain('/');
      expect(paramToAutomationSlug(param)).toBe(name);
    }
  });
});
