'use client';

/** An app's page in the Apps hub: renders the app's view configs through the
 * generic ViewRenderer. Pure data — the app's `views/*.json` drive everything. */
import { EmptyState } from '@tale/ui/empty-state';
import { VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import { useApps } from '../hooks/use-apps';
import { ViewRenderer } from './view-renderer';

export function AppPage({
  organizationId,
  appSlug,
}: {
  organizationId: string;
  appSlug: string;
}) {
  const { t } = useT('apps');
  const { apps, isLoading } = useApps(organizationId);
  const app = apps.find((a) => a.slug === appSlug);

  if (isLoading && !app) return <SkeletonText lines={6} />;
  if (!app) {
    return (
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    );
  }
  if (app.views.length === 0) {
    return (
      <EmptyState
        title={t('noViews.title')}
        description={t('noViews.description')}
      />
    );
  }

  return (
    <VStack gap={6}>
      {app.views.map((view) => {
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
