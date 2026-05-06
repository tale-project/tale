import { describe, expect, it } from 'vitest';

import {
  formatApproximateCurrency,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
} from './format';

// Intl.NumberFormat output varies subtly across ICU builds: it can use a
// non-breaking space (U+00A0) or a narrow no-break space (U+202F) before
// the currency digits, and Swiss locales use a typographic right single
// quote (U+2019) for grouping on full-ICU runtimes but fall back to a
// plain apostrophe (U+0027) on slim-ICU runtimes (the CI Node image is
// one such environment). The component renders all variants correctly in
// HTML — we normalize here so the assertions stay readable and pass on
// every runtime.
function normalize(value: string): string {
  return value
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'");
}

describe('formatNumber', () => {
  it('formats with English locale grouping', () => {
    expect(formatNumber(1199, { locale: 'en-US' })).toBe('1,199');
  });

  it('uses apostrophe grouping for Swiss German', () => {
    expect(normalize(formatNumber(1199, { locale: 'de-CH' }))).toBe("1'199");
  });

  it('respects fraction digit options', () => {
    expect(
      formatNumber(2.5, {
        locale: 'en-US',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe('2.50');
  });
});

describe('formatCurrency', () => {
  it('renders ISO currency code by default', () => {
    expect(
      normalize(
        formatCurrency(299, {
          currency: 'CHF',
          locale: 'en-US',
          maximumFractionDigits: 0,
        }),
      ),
    ).toBe('CHF 299');
  });

  it('uses Swiss apostrophe grouping with de-CH', () => {
    const result = normalize(
      formatCurrency(1199, {
        currency: 'CHF',
        locale: 'de-CH',
        maximumFractionDigits: 0,
      }),
    );
    expect(result).toContain('CHF');
    expect(result).toContain("1'199");
  });

  it('renders € for EUR with narrowSymbol', () => {
    const result = normalize(
      formatCurrency(50, {
        currency: 'EUR',
        locale: 'en-US',
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
      }),
    );
    expect(result).toContain('€50');
  });
});

describe('formatCompactCurrency', () => {
  it('produces lowercase k for thousands', () => {
    expect(
      normalize(
        formatCompactCurrency(2000, { currency: 'CHF', locale: 'en-US' }),
      ),
    ).toBe('CHF 2k');
  });

  it('keeps a single fraction digit when meaningful', () => {
    expect(
      normalize(
        formatCompactCurrency(2100, { currency: 'CHF', locale: 'en-US' }),
      ),
    ).toBe('CHF 2.1k');
  });

  it('keeps M uppercase for millions', () => {
    const result = normalize(
      formatCompactCurrency(1_500_000, {
        currency: 'CHF',
        locale: 'en-US',
      }),
    );
    expect(result).toContain('1.5M');
  });
});

describe('formatApproximateCurrency', () => {
  it('prefixes the amount with ~', () => {
    expect(
      normalize(
        formatApproximateCurrency(2000, {
          currency: 'CHF',
          locale: 'en-US',
        }),
      ),
    ).toBe('CHF ~2k');
  });

  it('honors a custom approximation prefix', () => {
    expect(
      normalize(
        formatApproximateCurrency(2100, {
          currency: 'CHF',
          locale: 'en-US',
          approximationPrefix: 'ca. ',
        }),
      ),
    ).toBe('CHF ca. 2.1k');
  });
});
