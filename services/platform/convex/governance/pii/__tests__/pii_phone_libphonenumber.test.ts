import { describe, expect, it } from 'vitest';

import {
  PHONES_INTL,
  PHONES_LOCAL_WITH_CONTEXT,
  PHONES_NEGATIVES,
} from '../../../../test/pii-fixtures/phones-intl';
import type { PhoneCase } from '../../../../test/pii-fixtures/types';
import { detectPii } from '../pii_detector';
import { getEnabledPatterns } from '../pii_patterns';

const phonePatterns = getEnabledPatterns(['phone']);

function actualMatches(input: string): string[] {
  return detectPii(input, phonePatterns).map((m) => m.matchedText);
}

function runFixture(label: string, cases: PhoneCase[]) {
  describe(label, () => {
    for (const c of cases) {
      const title = c.note
        ? `${JSON.stringify(c.input)} — ${c.note}`
        : JSON.stringify(c.input);
      it(title, () => {
        expect(actualMatches(c.input)).toEqual(c.expectedMatches);
      });
    }
  });
}

runFixture('phones (international, libphonenumber-js path)', PHONES_INTL);
runFixture('phones (local-format with context)', PHONES_LOCAL_WITH_CONTEXT);
runFixture('phones (negatives)', PHONES_NEGATIVES);
