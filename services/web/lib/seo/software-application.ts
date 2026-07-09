import { buildSoftwareApplicationJsonLd } from '@tale/ui/seo/builders/json-ld';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';

import { SUPPORTED_LOCALES } from '@/lib/i18n/locales';
import { PER_USER_MONTHLY } from '@/lib/pricing/tiers';

/**
 * The one SoftwareApplication node (`@id: …/#software`) describing Tale,
 * re-declared identically on `/` and `/pricing`. Offers
 * source their prices from `lib/pricing/tiers.ts` — the same constants the
 * pricing UI renders — so declared and displayed prices cannot drift.
 */
export function buildTaleSoftwareApplicationJsonLd(
  description: string,
): string {
  return buildSoftwareApplicationJsonLd({
    id: `${TALE_SITE_URL}/#software`,
    name: 'Tale',
    url: TALE_SITE_URL,
    description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Linux (Docker, self-hosted)',
    licenseUrl: `${TALE_GITHUB_URL}/blob/main/LICENSE`,
    inLanguage: [...SUPPORTED_LOCALES],
    sameAs: [TALE_GITHUB_URL],
    offers: [
      { name: 'Community', price: '0', priceCurrency: 'CHF' },
      {
        name: 'Enterprise',
        price: String(PER_USER_MONTHLY.CH),
        priceCurrency: 'CHF',
        unitText: 'per user per month',
      },
      {
        name: 'Enterprise',
        price: String(PER_USER_MONTHLY.DE),
        priceCurrency: 'EUR',
        unitText: 'per user per month',
      },
    ],
  });
}
