'use client';

import { Button } from '@tale/ui/button';
import { PageSection } from '@tale/ui/page-section';
import { Text } from '@tale/ui/text';
import { RefreshCw } from 'lucide-react';
import { useCallback } from 'react';

import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface ModelCatalogCardProps {
  organizationId: string;
  /** Forwarded to the section root (e.g. a divider border). */
  className?: string;
}

/**
 * Providers-settings card for the model-capability catalog: shows when it was
 * last synced from the proven source (OpenRouter) and offers a manual refresh.
 * The cron keeps it fresh automatically; this is the on-demand escape hatch.
 */
export function ModelCatalogCard({
  organizationId,
  className,
}: ModelCatalogCardProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const { data: status } = useConvexQuery(
    api.model_catalog.queries.getCatalogStatus,
    { organizationId },
  );
  const sync = useConvexAction(api.model_catalog.sync.syncModelCatalog);
  const { data: syncSettings } = useConvexQuery(
    api.model_catalog.queries.getModelSyncSettings,
    { organizationId },
  );
  const setAutoSync = useConvexAction(api.model_catalog.sync.setModelAutoSync);

  const latest = status?.[0];

  const onToggleAutoSync = useCallback(
    (enabled: boolean) => {
      void setAutoSync
        .mutateAsync({ organizationId, enabled })
        .catch((err: unknown) =>
          toast({
            title: t('providers.modelCatalog.autoSyncFailed', {
              error: err instanceof Error ? err.message : String(err),
            }),
            variant: 'destructive',
          }),
        );
    },
    [organizationId, setAutoSync, t],
  );

  const onRefresh = useCallback(() => {
    void sync
      .mutateAsync({ organizationId })
      .then((res) => {
        if (res.ok) {
          toast({
            title: t('providers.modelCatalog.synced', {
              count: res.modelCount,
            }),
          });
        } else {
          toast({
            title: t('providers.modelCatalog.syncFailed', {
              error: res.error ?? 'unknown',
            }),
            variant: 'destructive',
          });
        }
      })
      .catch((err: unknown) =>
        toast({
          title: t('providers.modelCatalog.syncFailed', {
            error: err instanceof Error ? err.message : String(err),
          }),
          variant: 'destructive',
        }),
      );
  }, [organizationId, sync, t]);

  return (
    <PageSection
      as="h2"
      className={className}
      title={t('providers.modelCatalog.title')}
      description={t('providers.modelCatalog.description')}
    >
      <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
        <Text as="span" variant="caption" className="text-muted-foreground">
          {latest
            ? latest.ok
              ? t('providers.modelCatalog.lastSynced', {
                  when: formatDate(new Date(latest.lastSyncedAt), 'long'),
                  count: latest.modelCount,
                })
              : t('providers.modelCatalog.lastFailed', {
                  when: formatDate(new Date(latest.lastSyncedAt), 'long'),
                })
            : t('providers.modelCatalog.neverSynced')}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={sync.isPending}
          icon={RefreshCw}
          iconClassName={sync.isPending ? 'animate-spin' : undefined}
        >
          {t('providers.modelCatalog.refresh')}
        </Button>
      </div>
      <SettingsToggleRow
        label={t('providers.modelCatalog.autoSync')}
        description={t('providers.modelCatalog.autoSyncHelp')}
        checked={syncSettings?.autoSyncEnabled ?? true}
        ariaBusy={syncSettings === undefined}
        disabled={setAutoSync.isPending}
        onCheckedChange={onToggleAutoSync}
      />
    </PageSection>
  );
}
