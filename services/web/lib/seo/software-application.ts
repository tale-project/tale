import { buildSoftwareApplicationJsonLd } from '@tale/ui/seo/builders/json-ld';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';

import { SUPPORTED_LOCALES } from '@/lib/i18n/locales';

/**
 * The one SoftwareApplication node (`@id: …/#software`) describing Tale,
 * re-declared identically on every page that carries it.
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
  });
}
