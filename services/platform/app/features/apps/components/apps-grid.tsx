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
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { type AppSummary, useApps } from '../hooks/use-apps';
import {
  type AppInstallState,
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';
import { AppLifecycleActions } from './app-lifecycle-actions';
import { AppInstallWizard } from './install-wizard/app-install-wizard';

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
  // The app whose install wizard is open. Project-scoped apps (need a target
  // project) and apps with required integrations (need a connect step) route
  // through the wizard; org-scoped apps with no requirements install in one click.
  const [wizardApp, setWizardApp] = useState<AppSummary | null>(null);

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
        // A project-scoped installed app opens inside its bound project; org apps
        // (and not-yet-installed apps) use the org-level app page.
        const cardLink =
          state?.projectId !== undefined
            ? ({
                to: '/dashboard/$id/projects/$projectId/apps/$appSlug',
                params: {
                  id: organizationId,
                  projectId: state.projectId,
                  appSlug: app.slug,
                },
              } as const)
            : ({
                to: '/dashboard/$id/apps/$appSlug',
                params: { id: organizationId, appSlug: app.slug },
              } as const);
        return (
          <div key={app.slug} className="relative h-full">
            <Link {...cardLink} aria-label={app.name} className="block h-full">
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
                  {/* Reserve the footer row for the overlaid action (Install for
                      not-installed apps, the lifecycle ⋯ menu for installed). */}
                  <div className="h-8" />
                </VStack>
              </Card>
            </Link>
            {/* Interactive controls live OUTSIDE the card Link so they don't
                trigger navigation; the dropdown content portals out. */}
            {state ? (
              <div className="absolute right-3 bottom-3 z-10">
                <AppLifecycleActions
                  appSlug={app.slug}
                  appName={app.name}
                  organizationId={organizationId}
                  projectId={state.projectId}
                />
              </div>
            ) : (
              <div className="absolute bottom-3 left-3 z-10">
                <Button
                  size="sm"
                  disabled={isPending}
                  onClick={() =>
                    app.scope === 'project' ||
                    app.requiredIntegrations.length > 0
                      ? setWizardApp(app)
                      : void install(app.slug)
                  }
                >
                  {t('install.install')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {wizardApp && (
        <AppInstallWizard
          open
          onOpenChange={(o) => {
            if (!o) setWizardApp(null);
          }}
          organizationId={organizationId}
          appSlug={wizardApp.slug}
          appName={wizardApp.name}
          scope={wizardApp.scope}
          requiredIntegrations={wizardApp.requiredIntegrations}
        />
      )}
    </Grid>
  );
}
