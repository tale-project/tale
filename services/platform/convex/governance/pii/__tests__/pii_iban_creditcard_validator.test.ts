import { describe, expect, it } from 'vitest';

import {
  CREDIT_CARD_CASES,
  IBAN_CASES,
} from '../../../../test/pii-fixtures/iban-creditcard';
import { detectPii } from '../pii_detector';
import { getEnabledPatterns } from '../pii_patterns';

const ibanPatterns = getEnabledPatterns(['iban']);
const ccPatterns = getEnabledPatterns(['creditCard']);

describe('IBAN with validator.isIBAN post-filter', () => {
  for (const c of IBAN_CASES) {
    const title = c.note
      ? `${JSON.stringify(c.input)} — ${c.note}`
      : JSON.stringify(c.input);
    it(title, () => {
      const matches = detectPii(c.input, ibanPatterns);
      if (c.shouldMatch) {
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].patternName).toBe('iban');
      } else {
        expect(matches).toHaveLength(0);
      }
    });
  }
});

describe('Credit card with validator.isCreditCard (Luhn)', () => {
  for (const c of CREDIT_CARD_CASES) {
    const title = c.note
      ? `${JSON.stringify(c.input)} — ${c.note}`
      : JSON.stringify(c.input);
    it(title, () => {
      const matches = detectPii(c.input, ccPatterns);
      if (c.shouldMatch) {
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].patternName).toBe('creditCard');
      } else {
        expect(matches).toHaveLength(0);
      }
    });
  }
});
