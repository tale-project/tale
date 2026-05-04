import { describe, expect, it } from 'vitest';

import { ADDRESSES_CH } from '../../../../test/pii-fixtures/addresses-ch';
import {
  ADDRESSES_DE,
  ADDRESSES_DE_NEGATIVES,
} from '../../../../test/pii-fixtures/addresses-de';
import {
  ADDRESSES_EN,
  ADDRESSES_EN_NEGATIVES,
} from '../../../../test/pii-fixtures/addresses-en';
import {
  ADDRESSES_FR,
  ADDRESSES_FR_NEGATIVES,
} from '../../../../test/pii-fixtures/addresses-fr';
import {
  ADDRESSES_NL,
  ADDRESSES_NL_NEGATIVES,
} from '../../../../test/pii-fixtures/addresses-nl';
import type { AddressCase } from '../../../../test/pii-fixtures/types';
import { detectPii } from '../pii_detector';
import { getEnabledPatterns } from '../pii_patterns';

const addressPatterns = getEnabledPatterns(['address']);

function actualMatches(input: string): string[] {
  return detectPii(input, addressPatterns).map((m) => m.matchedText);
}

function runFixture(label: string, cases: AddressCase[]) {
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

runFixture('addresses (DE positive)', ADDRESSES_DE);
runFixture('addresses (DE negative)', ADDRESSES_DE_NEGATIVES);
runFixture('addresses (FR positive)', ADDRESSES_FR);
runFixture('addresses (FR negative)', ADDRESSES_FR_NEGATIVES);
runFixture('addresses (CH positive)', ADDRESSES_CH);
runFixture('addresses (EN positive)', ADDRESSES_EN);
runFixture('addresses (EN negative)', ADDRESSES_EN_NEGATIVES);
runFixture('addresses (NL positive)', ADDRESSES_NL);
runFixture('addresses (NL negative)', ADDRESSES_NL_NEGATIVES);
