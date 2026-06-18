'use client';

/** The Apps hub landing: a config-driven grid of apps. Each app is a first-class
 * apps/<slug>/app.json bundle. A card shows the app's install state and an
 * Install button (not-installed) / Setup or Reinstall hint (installed) — the
 * whole lifecycle starts here. */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid, HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useApps } from '../hooks/use-apps';
import {
  type AppInstallState,
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';

function InstallBadge({ state }: { state: AppInstallState }) {
  const { t } = useT('apps');
  if (state.status === 'broken') {
    return <Badge variant="destructive">{t('install.reinstall')}</Badge>;
  }
  if (state.blockedIntegrations.length > 0) {
    return <Badge variant="yellow">{t('install.setup')}</Badge>;
  }
  return <Badge variant="green">{t('install.installed')}</Badge>;
}

export function AppsGrid({ organizationId }: { organizationId: string }) {
  const { t } = useT('apps');
  const { apps, isLoading } = useApps(organizationId);
  const { bySlug } = useAppInstallStates(organizationId);
  const { install, isPending } = useAppInstallActions(organizationId);

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
      {apps.map((app) => {
        const state = bySlug.get(app.slug);
        return (
          <div key={app.slug} className="relative h-full">
            <Link
              to="/dashboard/$id/apps/$appSlug"
              params={{ id: organizationId, appSlug: app.slug }}
              aria-label={app.name}
              className="block h-full"
            >
              <Card className="hover:border-primary/50 h-full transition-colors">
                <VStack gap={3}>
                  <HStack gap={3} className="items-start justify-between">
                    <HStack gap={3} className="min-w-0 items-start">
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
                    {state && <InstallBadge state={state} />}
                  </HStack>
                  {!state && <div className="h-8" />}
                </VStack>
              </Card>
            </Link>
            {!state && (
              <div className="absolute bottom-3 left-3 z-10">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() => void install(app.slug)}
                >
                  {t('install.install')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </Grid>
  );
}
