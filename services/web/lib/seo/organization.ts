import { buildOrganizationJsonLd } from '@tale/ui/seo/builders/json-ld';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';

/**
 * Canonical Organization JSON-LD for Tale / Ruler GmbH. Re-declare on
 * entity-trust pages (home, about, security, open-source) with the same `@id`
 * so crawlers and LLMs merge one publisher node.
 */
export function buildTaleOrganizationJsonLd(): string {
  return buildOrganizationJsonLd({
    id: `${TALE_SITE_URL}/#org`,
    name: 'Tale',
    url: TALE_SITE_URL,
    legalName: 'Ruler GmbH',
    vatID: 'CHE-186.532.610',
    address: {
      streetAddress: 'Seestrasse 4',
      postalCode: '3700',
      addressLocality: 'Spiez',
      addressCountry: 'CH',
    },
    logoUrl: `${TALE_SITE_URL}/favicon-light.png`,
    sameAs: [TALE_GITHUB_URL],
  });
}
