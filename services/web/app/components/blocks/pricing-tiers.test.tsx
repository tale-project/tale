import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import type { SupportedLocale } from '@/lib/i18n/locales';
import type { Region } from '@/lib/pricing/region';

import { PricingTiers } from './pricing-tiers';

const page = vi.hoisted(() => ({ locale: 'en' as SupportedLocale }));

vi.mock('@/lib/i18n/use-current-locale', () => ({
  useCurrentLocale: () => page.locale,
}));

vi.mock('@/app/components/marketing', () => ({
  MarketingButton: ({ children }: { children: ReactNode }) => children,
  MarketingExternalLink: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
  MarketingLink: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

/** Turns the no-break spaces Intl puts in numbers (U+00A0, U+202F) into plain spaces. */
function plainSpaces(text: string): string {
  return text.replace(/\s/g, ' ');
}

/** The visible text of the tiers on the `locale` page, billed monthly. */
async function renderText(
  locale: SupportedLocale,
  region: Region,
  users: number,
) {
  page.locale = locale;
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(
    <PricingTiers
      billing="monthly"
      region={region}
      users={users}
      onBillingChange={vi.fn()}
      onRegionChange={vi.fn()}
      onUsersChange={vi.fn()}
    />,
  );
  const document = new DOMParser().parseFromString(html, 'text/html');
  return plainSpaces(document.body.textContent ?? '');
}

/**
 * The region picks the currency and the page language picks the
 * separators: a seat costs EUR 14 a month, so 100 users cost EUR 1,400.
 */
const EURO_PAGES = [
  {
    locale: 'en',
    max: '1,000+',
    total: 'EUR 1,400',
    breakdown: '1,200 users × EUR 14/user/month',
  },
  {
    locale: 'de',
    max: '1.000+',
    total: '1.400 EUR',
    breakdown: '1.200 Nutzer × 14 EUR/Nutzer/Monat',
  },
  {
    locale: 'fr',
    max: '1 000+',
    total: '1 400 EUR',
    breakdown: '1 200 utilisateurs × 14 EUR/utilisateur/mois',
  },
] as const;

/**
 * Swiss prices use the Swiss variant of the page language. Its grouping mark
 * differs between ICU releases (the `@tale/ui/format` examples show `1’199`,
 * while ICU 78.3 renders `1'199`), so these expectations come from Intl.
 */
const SWISS_PAGES = [
  ['en', 'en-CH'],
  ['de', 'de-CH'],
  ['fr', 'fr-CH'],
] as const;

describe('pricing tiers', () => {
  it.each(EURO_PAGES)(
    'formats euro prices and user counts in the language of the $locale page',
    async ({ locale, max, total, breakdown }) => {
      const text = await renderText(locale, 'DE', 100);
      expect(text).toContain(max);
      expect(text).toContain(total);
      expect(await renderText(locale, 'DE', 1200)).toContain(breakdown);
    },
  );

  it.each(SWISS_PAGES)(
    'formats CHF prices on the %s page as %s',
    async (locale, swissLocale) => {
      const text = await renderText(locale, 'CH', 100);
      const count = new Intl.NumberFormat(swissLocale).format(1000);
      const total = new Intl.NumberFormat(swissLocale, {
        style: 'currency',
        currency: 'CHF',
        currencyDisplay: 'code',
        maximumFractionDigits: 0,
      }).format(1200);
      expect(text).toContain(plainSpaces(`${count}+`));
      expect(text).toContain(plainSpaces(total));
    },
  );
});
