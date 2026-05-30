'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Heading } from '@tale/ui/heading';
import { Grid, HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { Search, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { useT } from '@/lib/i18n/client';
import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { IntegrationCard } from './integration-card';
import { IntegrationPanel } from './integration-panel';
import { IntegrationUploadDialog } from './integration-upload/integration-upload-dialog';
import { SSOCard } from './sso-card';

/** Number of placeholder cards rendered while the integration list loads. */
const PLACEHOLDER_CARD_COUNT = 6;

/**
 * Placeholder card matching `IntegrationCard`'s footprint (icon tile + status
 * badge, title, two description lines) so the loading grid occupies the same
 * height as the loaded grid. Decorative; the enclosing `<Skeletonize>` owns the
 * single status announcement.
 */
function IntegrationCardSkeleton() {
  return (
    <Card contentClassName="p-0">
      <div className="w-full p-5 text-left">
        <Stack gap={3}>
          <HStack justify="between" align="start">
            <SkeletonBox className="size-11 rounded-lg" />
            <SkeletonBox className="h-5 w-16 rounded-full" />
          </HStack>
          <Stack gap={1}>
            <SkeletonText width="6rem" className="text-base leading-none" />
            <SkeletonText lines={2} className="text-sm leading-[1.43]" />
          </Stack>
        </Stack>
      </div>
    </Card>
  );
}

export interface IntegrationListItem {
  _id: string;
  slug: string;
  title: string;
  description?: string;
  type?: 'rest_api' | 'sql';
  authMethod: string;
  operationCount: number;
  hash: string;
  [key: string]: unknown;
}

interface IntegrationsProps {
  organizationId: string;
  integrations: IntegrationListItem[];
  ssoProvider: SsoProvider | null;
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
}

export function Integrations({
  organizationId,
  integrations,
  ssoProvider,
  tab = 'all',
  onTabChange,
  initialSlug,
  onInitialSlugConsumed,
  isLoading = false,
}: IntegrationsProps) {
  const { t } = useT('settings');

  const [searchQuery, setSearchQuery] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [managingIntegration, setManagingIntegration] =
    useState<IntegrationListItem | null>(null);
  const tabItems = useMemo(
    () => [
      { value: 'connected', label: t('integrations.tabs.connected') },
      { value: 'all', label: t('integrations.tabs.all') },
    ],
    [t],
  );

  const filteredIntegrations = useMemo(() => {
    let filtered = integrations;

    if (tab === 'connected') {
      filtered = filtered.filter((i) => i.isActive === true);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(query) ||
          (i.description ?? '').toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [integrations, tab, searchQuery]);

  const isSsoVisible = tab === 'all' || (tab === 'connected' && !!ssoProvider);
  const showSearch = searchQuery.trim().length > 0;

  const renderEmptyState = () => {
    if (showSearch) {
      return (
        <EmptyState
          icon={Search}
          title={t('integrations.empty.searchTitle')}
          description={t('integrations.empty.searchDescription')}
        />
      );
    }
    if (tab === 'connected') {
      return (
        <EmptyState
          icon={Unplug}
          title={t('integrations.empty.connectedTitle')}
          description={t('integrations.empty.connectedDescription')}
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
    <Stack gap={0} className="pb-8">
      <HStack wrap justify="between" align="start" className="pb-3">
        <Stack gap={1}>
          <Heading level={2} size="lg" tracking="tight">
            {t('integrations.title')}
          </Heading>
          <Text variant="muted">{t('integrations.pageSubtitle')}</Text>
        </Stack>
        <Button onClick={() => setUploadDialogOpen(true)}>
          {t('integrations.addCustomIntegration')}
        </Button>
      </HStack>

      <HStack wrap justify="between" align="center" className="mb-4">
        <Tabs items={tabItems} value={tab} onValueChange={onTabChange} />
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('integrations.searchPlaceholder')}
          className="w-64"
        />
      </HStack>

      {isLoading ? (
        <Skeletonize loading label={t('integrations.title')}>
          <Grid cols={1} md={2} lg={3}>
            {Array.from({ length: PLACEHOLDER_CARD_COUNT }).map((_, i) => (
              <IntegrationCardSkeleton key={i} />
            ))}
          </Grid>
        </Skeletonize>
      ) : filteredIntegrations.length > 0 || (isSsoVisible && !showSearch) ? (
        <Grid cols={1} md={2} lg={3}>
          {isSsoVisible && !showSearch && (
            <SSOCard
              organizationId={organizationId}
              ssoProvider={ssoProvider}
            />
          )}
          {filteredIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.slug}
              title={integration.title}
              description={integration.description}
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
            />
          ))}
        </Grid>
      ) : (
        renderEmptyState()
      )}

      <IntegrationUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
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
        />
      )}
    </Stack>
  );
}
