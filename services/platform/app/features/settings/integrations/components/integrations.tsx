'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Search, Unplug } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import { CatalogGrid } from '@/app/components/catalog/catalog-grid';
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { downloadBase64File } from '@/lib/utils/download';

import { useExportIntegration } from '../hooks/use-export-integration';
import { IntegrationCard } from './integration-card';
import { IntegrationPanel } from './integration-panel';
import { IntegrationUploadDialog } from './integration-upload/integration-upload-dialog';

export interface IntegrationListItem {
  _id: string;
  slug: string;
  title: string;
  description?: string;
  /** Definition catalog chips, rendered in the card's meta row. */
  labels?: string[];
  type?: 'rest_api' | 'sql';
  authMethod: string;
  operationCount: number;
  hash: string;
  [key: string]: unknown;
}

/** Search matches an integration's title or description. */
function integrationHaystack(
  item: IntegrationListItem,
): ReadonlyArray<string | undefined> {
  return [item.title, item.description];
}

interface IntegrationsProps {
  organizationId: string;
  integrations: IntegrationListItem[];
  tab?: string;
  onTabChange: (tab: string) => void;
  /** Deep-link target — opens the matching integration's detail panel once. */
  initialSlug?: string;
  /** Called after `initialSlug` has been handled so the caller can clear the URL. */
  onInitialSlugConsumed?: () => void;
  /**
   * While true the card grid renders skeleton placeholders inside the real
   * header/tabs/search layout, so the integration list resolves under stable
   * page chrome instead of swapping in from a separate page-level skeleton.
   */
  isLoading?: boolean;
  /** Controls the "Add integration" upload dialog opened from `toolbarAction`. */
  addDialogOpen: boolean;
  onAddDialogOpenChange: (open: boolean) => void;
  /** Right-aligned toolbar slot (the page's Add-integration menu) — rendered
   *  in the search row, next to the search input. */
  toolbarAction?: ReactNode;
}

export function Integrations({
  organizationId,
  integrations,
  tab = 'all',
  onTabChange,
  initialSlug,
  onInitialSlugConsumed,
  isLoading = false,
  addDialogOpen,
  onAddDialogOpenChange,
  toolbarAction,
}: IntegrationsProps) {
  const { t } = useT('settings');

  const { mutateAsync: exportIntegration } = useExportIntegration();
  const [exportingSlug, setExportingSlug] = useState<string | null>(null);
  const handleExport = useCallback(
    async (item: IntegrationListItem) => {
      if (exportingSlug) return;
      setExportingSlug(item.slug);
      try {
        const result = await exportIntegration({
          organizationId,
          slug: item.slug,
        });
        downloadBase64File(
          result.filename,
          result.dataBase64,
          'application/zip',
        );
      } catch (error) {
        console.error(error);
        toast({
          title: t('integrations.export.failed', {
            defaultValue: 'Failed to export integration',
          }),
          variant: 'destructive',
        });
      } finally {
        setExportingSlug(null);
      }
    },
    [exportingSlug, exportIntegration, organizationId, t],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [managingIntegration, setManagingIntegration] =
    useState<IntegrationListItem | null>(null);
  const tabItems = useMemo(
    () => [
      { value: 'connected', label: t('integrations.tabs.connected') },
      { value: 'all', label: t('integrations.tabs.all') },
    ],
    [t],
  );

  const tabbedIntegrations = useMemo(
    () =>
      tab === 'connected'
        ? integrations.filter((i) => i.isActive === true)
        : integrations,
    [integrations, tab],
  );
  const filteredIntegrations = useCatalogSearch(
    tabbedIntegrations,
    searchQuery,
    integrationHaystack,
  );

  const showSearch = searchQuery.trim().length > 0;

  // Nothing to search on the Connected tab when no integration is connected.
  const connectedCount = useMemo(
    () => integrations.filter((i) => i.isActive === true).length,
    [integrations],
  );
  const searchDisabled =
    !isLoading && tab === 'connected' && connectedCount === 0;

  const renderEmptyState = () => {
    if (showSearch) {
      return (
        <EmptyState
          icon={Search}
          title={t('integrations.noResults.title')}
          description={t('integrations.noResults.description')}
          className="min-h-0"
        />
      );
    }
    if (tab === 'connected') {
      return (
        <EmptyState
          icon={Unplug}
          title={t('integrations.empty.connectedTitle')}
          description={t('integrations.empty.connectedDescription')}
          className="min-h-0"
        />
      );
    }
    return null;
  };

  const handleCardClick = useCallback((integration: IntegrationListItem) => {
    setManagingIntegration(integration);
  }, []);

  const consumedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialSlug || consumedSlugRef.current === initialSlug) return;
    const match = integrations.find((i) => i.slug === initialSlug);
    if (!match) return;
    consumedSlugRef.current = initialSlug;
    setManagingIntegration(match);
    onInitialSlugConsumed?.();
  }, [initialSlug, integrations, onInitialSlugConsumed]);

  return (
    // Fill the settings pane so EmptyState (flex-1 + justify-center) sits in
    // the middle of the area below the tabs/search — same fix as Automations.
    <Stack gap={0} className="min-h-0 flex-1 pb-8">
      <CatalogToolbar
        className="mb-4 shrink-0"
        tabs={{ items: tabItems, value: tab, onValueChange: onTabChange }}
        search={{
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          placeholder: t('integrations.searchPlaceholder'),
          disabled: searchDisabled,
        }}
        action={toolbarAction}
      />

      {isLoading ? (
        <Skeletonize loading label={t('integrations.title')}>
          <CatalogGridSkeleton menu />
        </Skeletonize>
      ) : filteredIntegrations.length > 0 ? (
        <CatalogGrid>
          {filteredIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.slug}
              title={integration.title}
              description={integration.description}
              labels={integration.labels}
              isActive={integration.isActive === true}
              status={
                typeof integration.status === 'string'
                  ? integration.status
                  : undefined
              }
              iconUrl={
                typeof integration.iconUrl === 'string'
                  ? integration.iconUrl
                  : undefined
              }
              onClick={() => handleCardClick(integration)}
              onExport={() => void handleExport(integration)}
            />
          ))}
        </CatalogGrid>
      ) : (
        renderEmptyState()
      )}

      <IntegrationUploadDialog
        open={addDialogOpen}
        onOpenChange={onAddDialogOpenChange}
        organizationId={organizationId}
      />

      {managingIntegration && (
        <IntegrationPanel
          open={!!managingIntegration}
          onOpenChange={(open) => {
            if (!open) setManagingIntegration(null);
          }}
          integration={managingIntegration}
          organizationId={organizationId}
          onExport={() => void handleExport(managingIntegration)}
          isExporting={exportingSlug === managingIntegration.slug}
        />
      )}
    </Stack>
  );
}
