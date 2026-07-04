'use client';

/** The Apps hub landing: a config-driven grid of apps in the shared catalog
 * style (the same `CatalogCard` grid the agents, automations, and integrations
 * catalogs use). Each app is a first-class apps/<slug>/app.json bundle. A card
 * shows the app's install state badge and carries the lifecycle in its footer:
 * Install (not installed) or Open + the ⋯ menu (installed). */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card, CardGrid } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, Row, Stack, VStack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import { type AppSummary, useAppCatalog, useApps } from '../hooks/use-apps';
import {
  type AppInstallState,
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';
import { AppDeleteAction } from './app-delete-action';
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

function InstallBadge({ state }: { state: AppInstallState | undefined }) {
  const { t } = useT('apps');
  if (!state) {
    return <Badge variant="outline">{t('install.available')}</Badge>;
  }
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
  // A private (uploaded) app lives in the org's apps dir but not the built-in
  // catalog. It's the only kind the UI offers a Delete for (the server refuses
  // any built-in slug regardless), and it earns a "Private" badge so it's
  // distinguishable from a built-in card sharing the same display name.
  const catalogSlugs = useMemo(
    () => new Set(catalog.map((a) => a.slug)),
    [catalog],
  );
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
        <CatalogGrid>
          {filteredApps.map((app) => {
            const state = bySlug.get(app.slug);
            const isPrivate = !catalogSlugs.has(app.slug);
            return (
              <CatalogCard
                key={app.slug}
                media={
                  <CatalogCardIcon>
                    <LayoutGrid className="text-muted-foreground size-5" />
                  </CatalogCardIcon>
                }
                title={app.name}
                description={app.description}
                badge={
                  <>
                    {isPrivate && <Badge variant="slate">{t('private')}</Badge>}
                    <InstallBadge state={state} />
                  </>
                }
                actions={
                  state ? (
                    <>
                      {/* Every installed app opens its org-level page. For a
                      project-scoped app that page is its membership hub (the
                      list of bound projects + Add); we never deep-link a single
                      project from the hub. */}
                      <Button variant="secondary" asChild>
                        <Link
                          to="/dashboard/$id/apps/$appSlug"
                          params={{ id: organizationId, appSlug: app.slug }}
                        >
                          {t('install.open')}
                        </Link>
                      </Button>
                      <div className="ml-auto">
                        <AppLifecycleActions
                          appSlug={app.slug}
                          appName={app.name}
                          organizationId={organizationId}
                          context="org"
                        />
                      </div>
                    </>
                  ) : (
                    <>
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
                      {isPrivate && (
                        <div className="ml-auto">
                          <AppDeleteAction
                            appSlug={app.slug}
                            appName={app.name}
                            organizationId={organizationId}
                          />
                        </div>
                      )}
                    </>
                  )
                }
              />
            );
          })}
        </CatalogGrid>
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
