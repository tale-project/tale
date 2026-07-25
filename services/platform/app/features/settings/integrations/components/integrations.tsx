'use client';

import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Loader2, Search, Unplug } from 'lucide-react';
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

import { useDuplicateIntegration } from '../hooks/use-duplicate-integration';
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
  /** Whether the "Duplicate" action is offered — false for OAuth / slug-bound
   *  integrations (see isDuplicableIntegration); projected by listIntegrations. */
  duplicable: boolean;
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

  const { mutateAsync: duplicateIntegration } = useDuplicateIntegration();
  const [duplicatingSlug, setDuplicatingSlug] = useState<string | null>(null);
  // After a duplicate resolves, open the new instance's panel once the
  // refetched list contains it (mirrors the `initialSlug` deep-link effect) so
  // the user lands on its credentials form instead of a dead-end grid.
  const [pendingOpenSlug, setPendingOpenSlug] = useState<string | null>(null);
  const handleDuplicate = useCallback(
    async (item: IntegrationListItem) => {
      if (duplicatingSlug) return;
      setDuplicatingSlug(item.slug);
      // Duplicating is a multi-step server action (clone config → mint an
      // inactive credential → rebind bundled automations), and the ⋯ menu that
      // launched it has already closed — so surface progress as a loading toast
      // that the success/error toast then replaces (the store keeps one toast).
      toast({
        title: (
          <span className="inline-flex items-center gap-2">
            {t('integrations.duplicate.pending', {
              name: item.title,
              defaultValue: 'Creating a copy of {name}…',
            })}
            <Loader2 className="size-4 animate-spin" />
          </span>
        ),
        duration: 60_000,
      });
      try {
        const result = await duplicateIntegration({
          organizationId,
          slug: item.slug,
        });
        toast({
          variant: 'success',
          title: t('integrations.duplicate.success', {
            name: item.title,
            defaultValue: 'Created a copy of {name}',
          }),
        });
        // The new instance is inactive, so it only shows on the "all" tab —
        // switch there and open it so Duplicate never dead-ends on Connected.
        onTabChange('all');
        setPendingOpenSlug(result.newSlug);
      } catch (error) {
        console.error(error);
        toast({
          title: t('integrations.duplicate.failed', {
            defaultValue: 'Failed to duplicate integration',
          }),
          variant: 'destructive',
        });
      } finally {
        setDuplicatingSlug(null);
      }
    },
    [duplicatingSlug, duplicateIntegration, onTabChange, organizationId, t],
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
      // Connected is empty until something is wired — send people to the
      // catalog instead of leaving a dead-end message under the tab.
      return (
        <EmptyState
          icon={Unplug}
          title={t('integrations.empty.connectedTitle')}
          description={t('integrations.empty.connectedDescription')}
          className="min-h-0"
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => onTabChange('all')}
            >
              {t('integrations.empty.browseAll')}
            </Button>
          }
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

  // Open a freshly duplicated instance once the invalidated list refetches and
  // includes it — then clear the pending slug so it opens exactly once.
  useEffect(() => {
    if (!pendingOpenSlug) return;
    const match = integrations.find((i) => i.slug === pendingOpenSlug);
    if (!match) return;
    setManagingIntegration(match);
    setPendingOpenSlug(null);
  }, [pendingOpenSlug, integrations]);

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
              onDuplicate={
                integration.duplicable
                  ? () => void handleDuplicate(integration)
                  : undefined
              }
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
          onDuplicate={
            managingIntegration.duplicable
              ? () => void handleDuplicate(managingIntegration)
              : undefined
          }
          isDuplicating={duplicatingSlug === managingIntegration.slug}
        />
      )}
    </Stack>
  );
}
