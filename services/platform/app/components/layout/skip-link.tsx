import { SkipLink as SharedSkipLink } from '@tale/ui/skip-link';

import { useT } from '@/lib/i18n/client';

/** The platform's skip link: the shared control aimed at the app's `<main>`. */
export function SkipLink() {
  const { t } = useT('common');
  return (
    <SharedSkipLink targetId="main-content">
      {t('aria.skipToContent')}
    </SharedSkipLink>
  );
}
