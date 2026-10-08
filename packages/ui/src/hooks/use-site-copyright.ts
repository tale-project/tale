'use client';

import { useT } from '@tale/ui/i18n/client';

/** Shared copyright and license footnote for Tale's public sites. */
export function useSiteCopyright(): string {
  const { t } = useT('siteFooter');
  return t('copyright', { year: new Date().getFullYear() });
}
