'use client';

/** A pack's page in the Apps hub: renders the pack's view configs through the
 * generic ViewRenderer. Pure data — the pack's `views/*.json` drive everything. */
import { EmptyState } from '@tale/ui/empty-state';
import { VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import { usePacks } from '../hooks/use-packs';
import { ViewRenderer } from './view-renderer';

export function PackPage({
  organizationId,
  packSlug,
}: {
  organizationId: string;
  packSlug: string;
}) {
  const { t } = useT('apps');
  const { packs, isLoading } = usePacks(organizationId);
  const pack = packs.find((p) => p.slug === packSlug);

  if (isLoading && !pack) return <SkeletonText lines={6} />;
  if (!pack) {
    return (
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    );
  }
  if (pack.views.length === 0) {
    return (
      <EmptyState
        title={t('noViews.title')}
        description={t('noViews.description')}
      />
    );
  }

  return (
    <VStack gap={6}>
      {pack.views.map((view) => {
        const title = view.titleKey
          ? t(view.titleKey, { defaultValue: view.title ?? view.id })
          : view.title;
        return (
          <VStack key={view.id} gap={3}>
            {title && (
              <Text as="span" className="text-lg font-semibold">
                {title}
              </Text>
            )}
            <ViewRenderer view={view} organizationId={organizationId} />
          </VStack>
        );
      })}
    </VStack>
  );
}
