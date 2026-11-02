import { SkipLink as SharedSkipLink } from '@tale/ui/skip-link';

import { MAIN_CONTENT_ID } from '@/app/lib/main-area';
import { useT } from '@/lib/i18n/client';

/** The shared skip link, aimed at the app's `<main>`. */
export function SkipLink() {
  const { t } = useT('navigation');
  return (
    <SharedSkipLink targetId={MAIN_CONTENT_ID}>
      {t('skipToContent')}
    </SharedSkipLink>
  );
}
