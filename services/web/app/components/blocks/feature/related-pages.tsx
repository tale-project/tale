import { cn } from '@tale/ui/cn';

import {
  MarketingCard,
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
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

function relatedGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2 || count === 4) return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
}

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

  const pages = ids
    .filter((id) => id !== currentId)
    .map((id) => getPlatformPage(id));

  if (pages.length === 0) return null;

  return (
    <PageSection pad="xl" border="b">
      <MarketingStack max="xl" gap="xl" align="stretch">
        <SectionHeading
          size="section"
          as="h2"
          title={heading ?? t('relatedHeading')}
          align="start"
        />
        <MarketingPanel>
          <ul
            role="list"
            className={cn(
              'bg-border-base grid gap-px',
              relatedGridClass(pages.length),
            )}
          >
            {pages.map((page) => (
              <li key={page.id} className="bg-surface-site-raised">
                <MarketingCard
                  to={page.path}
                  title={tNav(`product.${page.navKey}.label`)}
                  description={tNav(`product.${page.navKey}.description`)}
                  icon={getPlatformIcon(page.id)}
                  className="h-full"
                  reveal={false}
                />
              </li>
            ))}
          </ul>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
