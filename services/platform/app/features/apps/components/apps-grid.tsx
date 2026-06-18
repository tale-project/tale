'use client';

/** The Apps hub landing: a config-driven grid of installed apps. Each app is a
 * first-class apps/<slug>/app.json bundle — a new app dir appears here with no
 * code change. */
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid, HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useApps } from '../hooks/use-apps';

export function AppsGrid({ organizationId }: { organizationId: string }) {
  const { t } = useT('apps');
  const { apps, isLoading } = useApps(organizationId);

  if (isLoading && apps.length === 0) return <SkeletonText lines={4} />;
  if (apps.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  return (
    <Grid className="grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map((app) => (
        <Link
          key={app.slug}
          to="/dashboard/$id/apps/$appSlug"
          params={{ id: organizationId, appSlug: app.slug }}
          className="block"
        >
          <Card className="hover:border-primary/50 h-full transition-colors">
            <HStack gap={3} className="items-start">
              <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                <LayoutGrid className="size-5" />
              </div>
              <VStack gap={1} className="min-w-0">
                <Text as="span" className="font-semibold" truncate>
                  {app.name}
                </Text>
                <Text variant="muted" className="line-clamp-2 text-sm">
                  {app.description}
                </Text>
              </VStack>
            </HStack>
          </Card>
        </Link>
      ))}
    </Grid>
  );
}
