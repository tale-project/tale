import type { Messages } from '@/lib/i18n/types';

import { i18n } from '@/lib/i18n/i18n';

type MetadataPage = {
  [K in keyof Messages['metadata']]: Messages['metadata'][K] extends {
    title: string;
  }
    ? K
    : never;
}[keyof Messages['metadata']];

export function seo(key: MetadataPage) {
  const suffix = i18n.t('metadata.suffix');
  const title = i18n.t(`metadata.${key}.title`);
  const description = i18n.t(`metadata.${key}.description`);
  const fullTitle = `${title} - ${suffix}`;

  const tags: Array<Record<string, string>> = [
    { title: fullTitle },
    { name: 'og:title', content: fullTitle },
    { name: 'og:type', content: 'website' },
  ];

  if (description) {
    tags.push(
      { name: 'description', content: description },
      { name: 'og:description', content: description },
    );
  }

  return tags;
}
