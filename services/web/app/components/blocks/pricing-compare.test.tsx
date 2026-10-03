import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { PricingCompare } from './pricing-compare';

vi.mock('@/app/components/marketing', () => ({
  MarketingButton: ({ children }: { children: ReactNode }) => children,
  MarketingLink: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const LOCALES = ['en', 'de', 'fr'] as const;

/** Each data row of the table as `label → [Community, Enterprise]`. */
async function renderRows(locale: string) {
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(<PricingCompare region="CH" />);
  const document = new DOMParser().parseFromString(html, 'text/html');
  return new Map(
    Array.from(document.querySelectorAll('tbody tr'))
      .filter((row) => row.querySelectorAll('td').length === 2)
      .map((row) => [
        row.querySelector('th[scope="row"]')?.textContent?.trim(),
        Array.from(row.querySelectorAll('td'), (cell) =>
          cell.querySelector('[aria-label]')?.getAttribute('aria-label'),
        ),
      ]),
  );
}

describe('pricing comparison', () => {
  it.each(LOCALES)(
    'keeps Enterprise-only compliance rows to services in %s',
    async (locale) => {
      const rows = await renderRows(locale);
      const t = i18n.getFixedT(locale, 'pricing');
      const included = t('compare.cellLabels.yes');
      const notIncluded = t('compare.cellLabels.no');

      // Every product feature ships in Community, so a data-protection row
      // Community lacks must name the agreement Ruler GmbH signs as processor.
      const dpa = t('compare.rows.dpa');
      expect(dpa).toMatch(locale === 'de' ? /\(AVV\)$/ : /\(DPA\)$/);
      expect(rows.get(dpa)).toEqual([notIncluded, included]);
      expect(rows.get(t('compare.rows.piiRedaction'))).toEqual([
        included,
        included,
      ]);
      // The Enterprise card names the same service as the table.
      expect(t('enterprise.feature3')).toBe(dpa);
    },
  );
});
