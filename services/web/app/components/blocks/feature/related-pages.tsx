import { RelatedPages as RelatedPagesPanel } from '@tale/marketing-ui/related-pages';

import {
  FOOTER_PLATFORM_PAGES,
  type PlatformPageId,
  getPlatformIcon,
  getPlatformPage,
} from '@/app/content/platform-pages';
import { useT } from '@/lib/i18n/client';

interface RelatedPagesProps {
  /** Current page id — excluded from the list. */
  currentId?: PlatformPageId;
  /** Explicit related ids; defaults to all footer platform pages minus current. */
  relatedIds?: readonly PlatformPageId[];
  heading?: string;
}

/**
 * Related platform modules — resolves page ids through the platform-page
 * registry (path, icon, nav copy) and hands the rows to the package panel.
 */
export function RelatedPages({
  currentId,
  relatedIds,
  heading,
}: RelatedPagesProps) {
  const { t } = useT('featureShared');
  const { t: tNav } = useT('nav');

  const ids =
    relatedIds ??
    FOOTER_PLATFORM_PAGES.map((p) => p.id).filter((id) => id !== currentId);

  const items = ids
    .filter((id) => id !== currentId)
    .map((id) => getPlatformPage(id))
    .map((page) => ({
      id: page.id,
      to: page.path,
      title: tNav(`product.${page.navKey}.label`),
      description: tNav(`product.${page.navKey}.description`),
      icon: getPlatformIcon(page.id),
    }));

  return (
    <RelatedPagesPanel heading={heading ?? t('relatedHeading')} items={items} />
  );
}
