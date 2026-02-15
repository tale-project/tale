import type { Messages } from '@/lib/i18n/types';

import { i18n } from '@/lib/i18n/i18n';

type MetadataPage = {
  [K in keyof Messages['metadata']]: Messages['metadata'][K] extends {
    title: string;
  }
    ? K
    : never;
}[keyof Messages['metadata']];

interface SeoOptions {
  ogType?: string;
}

export function seo(key: MetadataPage, options?: SeoOptions) {
  const suffix = i18n.t('metadata.suffix');
  const title = i18n.t(`metadata.${key}.title`);
  const description = i18n.t(`metadata.${key}.description`);
  const fullTitle = `${title} - ${suffix}`;
  const ogType = options?.ogType ?? 'website';

  const tags: Array<Record<string, string>> = [
    { title: fullTitle },
    { name: 'og:title', content: fullTitle },
    { name: 'og:type', content: ogType },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: fullTitle },
  ];

  if (description) {
    tags.push(
      { name: 'description', content: description },
      { name: 'og:description', content: description },
      { name: 'twitter:description', content: description },
    );
  }

  return tags;
}
