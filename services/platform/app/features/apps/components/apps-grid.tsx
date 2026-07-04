'use client';

/** The Apps hub landing: a config-driven grid of apps. Each app is a first-class
 * apps/<slug>/app.json bundle. A card shows the app's install state and an
 * Install button (not-installed) / Setup or Reinstall hint (installed) — the
 * whole lifecycle starts here. */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card, CardGrid } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, Row, Stack, VStack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import { type AppSummary, useAppCatalog, useApps } from '../hooks/use-apps';
import {
  type AppInstallState,
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';
import { AppLifecycleActions } from './app-lifecycle-actions';
import { AppInstallWizard } from './install-wizard/app-install-wizard';

/** Placeholder cards while the installed + catalog union loads. */
const PLACEHOLDER_CARD_COUNT = 6;

/**
 * Placeholder card matching the app hub card footprint (icon tile, title,
 * two-line description, footer action row) so the loading grid occupies the
 * same height as the loaded grid. Decorative; the enclosing `<Skeletonize>`
 * owns the single status announcement.
 */
function AppCardSkeleton() {
  return (
    <Card className="h-full">
      <VStack gap={3}>
        <HStack gap={3} className="items-start justify-between">
          <HStack gap={3} className="min-w-0 items-start">
            <SkeletonBox>
              <div className="size-9 rounded-md" />
            </SkeletonBox>
            <VStack gap={1} className="min-w-0 flex-1">
              <div className="w-28 text-sm leading-none">
                <SkeletonText />
              </div>
              <div className="text-sm leading-snug">
                <SkeletonText lines={2} />
              </div>
            </VStack>
          </HStack>
        </HStack>
        <div className="h-8" />
      </VStack>
    </Card>
  );
}

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

export function AppsGrid({
  organizationId,
  action,
}: {
  organizationId: string;
  /** Toolbar action rendered on the same row as the search input (e.g. the
   * "Upload app" button). Right-aligned; stays visible while apps load or when
   * none are installed yet. */
  action?: ReactNode;
}) {
  const { t } = useT('apps');
  // The hub shows the UNION of the org's installed apps and the built-in
  // catalog, keyed by slug. An installed entry wins (it carries the full
  // per-install data); a catalog-only entry renders the discovery card with an
  // Install button. This is what makes a fresh org's hub browsable instead of
  // empty until apps are seeded out-of-band.
  const { apps: installed, isLoading: installedLoading } =
    useApps(organizationId);
  const { apps: catalog, isLoading: catalogLoading } =
    useAppCatalog(organizationId);
  const isLoading = installedLoading || catalogLoading;
  const apps = useMemo(() => {
    const unionBySlug = new Map<string, AppSummary>();
    for (const app of catalog) unionBySlug.set(app.slug, app);
    for (const app of installed) unionBySlug.set(app.slug, app);
    return Array.from(unionBySlug.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [installed, catalog]);
  const { bySlug } = useAppInstallStates(organizationId);
  const { install, isPending } = useAppInstallActions(organizationId);
  // The app whose install wizard is open. Project-scoped apps (need a target
  // project) and apps with required integrations (need a connect step) route
  // through the wizard; org-scoped apps with no requirements install in one click.
  const [wizardApp, setWizardApp] = useState<AppSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        (app.description ?? '').toLowerCase().includes(q),
    );
  }, [apps, searchQuery]);

  const hasApps = apps.length > 0;
  const showToolbar = hasApps || action != null;

  // Loading: render the same toolbar + card-grid shape with placeholder cards
  // inside a single Skeletonize so the hub resolves under stable chrome rather
  // than swapping in from a blank text block.
  if (isLoading && !hasApps) {
    return (
      <Skeletonize loading label={t('title')}>
        <Stack gap={4}>
          <Row justify="between" gap={4}>
            <div className="w-64">
              <SkeletonBox>
                <div className="h-9 rounded-md" />
              </SkeletonBox>
            </div>
            {action ?? <span />}
          </Row>
          <CardGrid>
            {Array.from({ length: PLACEHOLDER_CARD_COUNT }).map((_, i) => (
              <AppCardSkeleton key={i} />
            ))}
          </CardGrid>
        </Stack>
      </Skeletonize>
    );
  }

  return (
    <Stack gap={4}>
      {showToolbar ? (
        <Row justify="between" gap={4}>
          {hasApps ? (
            <SearchInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-64"
            />
          ) : (
            <span />
          )}
          {action}
        </Row>
      ) : null}
      {!hasApps ? (
        <EmptyState
          icon={LayoutGrid}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : filteredApps.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t('searchNoResults')} />
      ) : (
        <CardGrid>
          {filteredApps.map((app) => {
            const state = bySlug.get(app.slug);
            // Every card opens the org-level app page. For a project-scoped app that
            // page is its membership hub (the list of bound projects + Add); we never
            // deep-link a single project from the hub, so the card behaves identically
            // whether the app is in 0, 1, or N projects.
            const cardLink = {
              to: '/dashboard/$id/apps/$appSlug',
              params: { id: organizationId, appSlug: app.slug },
            } as const;
            return (
              <div key={app.slug} className="relative h-full">
                <Link
                  {...cardLink}
                  aria-label={app.name}
                  className="block h-full"
                >
                  <Card interactive className="h-full">
                    <VStack gap={3}>
                      <HStack gap={3} className="items-start justify-between">
                        <HStack gap={3} className="min-w-0 items-start">
                          <Row
                            gap={0}
                            justify="center"
                            className="bg-muted text-muted-foreground size-9 shrink-0 rounded-md"
                          >
                            <LayoutGrid className="size-5" />
                          </Row>
                          <VStack gap={1} className="min-w-0">
                            <Text as="span" className="font-semibold" truncate>
                              {app.name}
                            </Text>
                            <Text
                              variant="muted"
                              className="line-clamp-2 text-sm"
                            >
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
                      context="org"
                    />
                  </div>
                ) : (
                  <div className="absolute bottom-3 left-3 z-10">
                    <Button
                      disabled={isPending}
                      onClick={() =>
                        app.scope === 'project' ||
                        app.requiredIntegrations.length > 0
                          ? setWizardApp(app)
                          : notifyOnInstallFailure(
                              install(app.slug),
                              t('install.installFailed'),
                            )
                      }
                    >
                      {t('install.install')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardGrid>
      )}
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
    </Stack>
  );
}
