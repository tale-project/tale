'use client';

/** An app's page in the Apps hub. Gates on install state: not-installed shows an
 * Install prompt; installed renders the app's views (the generic ViewRenderer)
 * with a NON-BLOCKING readiness checklist above them — missing integration
 * credentials route to the canonical connect flow; a broken install (a copied
 * resource was deleted) offers Reinstall. The app shell stays usable throughout. */
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { useApps } from '../hooks/use-apps';
import {
  useAppInstallActions,
  useAppInstallStates,
} from '../hooks/use-install-state';
import { AppView } from '../registry/app-view';

function ReadinessChecklist({
  organizationId,
  appSlug,
  status,
  blockedIntegrations,
}: {
  organizationId: string;
  appSlug: string;
  status: 'active' | 'broken';
  blockedIntegrations: string[];
}) {
  const { t } = useT('apps');
  const navigate = useNavigate();
  const { install, isPending } = useAppInstallActions(organizationId);

  if (status === 'active' && blockedIntegrations.length === 0) return null;

  return (
    <Alert variant="warning" title={t('readiness.title')}>
      <VStack gap={2} className="mt-1">
        {status === 'broken' && (
          <HStack gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.broken')}
            </Text>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => void install(appSlug)}
            >
              {t('install.reinstall')}
            </Button>
          </HStack>
        )}
        {blockedIntegrations.map((slug) => (
          <HStack key={slug} gap={3} className="items-center justify-between">
            <Text variant="muted" className="text-sm">
              {t('readiness.connect', { integration: slug })}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigate({
                  to: '/dashboard/$id/settings/integrations',
                  params: { id: organizationId },
                })
              }
            >
              {t('readiness.connectButton')}
            </Button>
          </HStack>
        ))}
      </VStack>
    </Alert>
  );
}

export function AppPage({
  organizationId,
  appSlug,
}: {
  organizationId: string;
  appSlug: string;
}) {
  const { t } = useT('apps');
  const { apps, isLoading } = useApps(organizationId);
  const { bySlug, isLoading: stateLoading } =
    useAppInstallStates(organizationId);
  const { install, uninstall, verify, isPending } =
    useAppInstallActions(organizationId);

  const app = apps.find((a) => a.slug === appSlug);
  const state = bySlug.get(appSlug);

  // Re-check that the copied files still exist when an installed app opens.
  // Guard by appSlug so it runs once per app (verify's identity is unstable and
  // it mutates the install status, which would otherwise re-fire in a loop).
  const installed = state !== undefined;
  const verifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (installed && verifiedRef.current !== appSlug) {
      verifiedRef.current = appSlug;
      void verify(appSlug);
    }
  }, [installed, appSlug, verify]);

  if ((isLoading && !app) || stateLoading) return <SkeletonText lines={6} />;
  if (!app) {
    return (
      <EmptyState
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
    );
  }

  if (!state) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('install.notInstalledTitle', { defaultValue: app.name })}
        description={t('install.notInstalledDescription')}
        action={
          <Button disabled={isPending} onClick={() => void install(appSlug)}>
            {t('install.install')}
          </Button>
        }
      />
    );
  }

  return (
    <VStack gap={6}>
      <ReadinessChecklist
        organizationId={organizationId}
        appSlug={appSlug}
        status={state.status}
        blockedIntegrations={state.blockedIntegrations}
      />
      {app.views.length === 0 ? (
        <EmptyState
          title={t('noViews.title')}
          description={t('noViews.description')}
        />
      ) : (
        app.views.map((view) => (
          <VStack key={view.id} gap={3}>
            {view.title && (
              <Text as="span" className="text-lg font-semibold">
                {view.title}
              </Text>
            )}
            <AppView
              organizationId={organizationId}
              appSlug={appSlug}
              allowlist={app.functions}
              data={view.data}
            />
          </VStack>
        ))
      )}
      <HStack gap={2} className="justify-end">
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => void uninstall(appSlug)}
        >
          {t('install.uninstall')}
        </Button>
      </HStack>
    </VStack>
  );
}
