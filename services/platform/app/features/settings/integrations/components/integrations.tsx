'use client';

import { Puzzle, Search, Unplug } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { EmptyState } from '@/app/components/ui/feedback/empty-state';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { IntegrationCard } from './integration-card';
import { IntegrationPanel } from './integration-panel';
import { IntegrationUploadDialog } from './integration-upload/integration-upload-dialog';
import { SSOCard } from './sso-card';

export interface IntegrationListItem {
  _id: string;
  slug: string;
  title: string;
  description?: string;
  installed: boolean;
  type?: 'rest_api' | 'sql';
  authMethod: string;
  operationCount: number;
  hash: string;
  [key: string]: unknown;
}

function isCustomIntegration(integration: IntegrationListItem) {
  const meta = integration.metadata;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    'source' in meta &&
    (meta as Record<string, unknown>).source === 'custom'
  );
}

interface IntegrationsProps {
  organizationId: string;
  integrations: IntegrationListItem[];
  ssoProvider: SsoProvider | null;
  tab?: string;
  onTabChange: (tab: string) => void;
}

export function Integrations({
  organizationId,
  integrations,
  ssoProvider,
  tab = 'all',
  onTabChange,
}: IntegrationsProps) {
  const { t } = useT('settings');

  const [searchQuery, setSearchQuery] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [managingIntegration, setManagingIntegration] =
    useState<IntegrationListItem | null>(null);
  const tabItems = useMemo(
    () => [
      { value: 'all', label: t('integrations.tabs.all') },
      { value: 'connected', label: t('integrations.tabs.connected') },
      { value: 'custom', label: t('integrations.tabs.custom') },
    ],
    [t],
  );

  const filteredIntegrations = useMemo(() => {
    let filtered = integrations;

    if (tab === 'connected') {
      filtered = filtered.filter((i) => i.isActive === true);
    } else if (tab === 'custom') {
      filtered = filtered.filter(isCustomIntegration);
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
    if (tab === 'custom') {
      return (
        <EmptyState
          icon={Puzzle}
          title={t('integrations.empty.customTitle')}
          description={t('integrations.empty.customDescription')}
        />
      );
    }
    return null;
  };

  const handleCardClick = useCallback((integration: IntegrationListItem) => {
    if (isCustomIntegration(integration)) {
      setUploadDialogOpen(true);
    } else {
      setManagingIntegration(integration);
    }
  }, []);

  return (
    <Stack gap={0} className="pb-8">
      <HStack justify="between" align="start" className="pb-3">
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

      <HStack justify="between" align="center" className="mb-4">
        <Tabs items={tabItems} value={tab} onValueChange={onTabChange} />
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('integrations.searchPlaceholder')}
          className="w-64"
        />
      </HStack>

      {filteredIntegrations.length > 0 || (isSsoVisible && !showSearch) ? (
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
              isCustom={isCustomIntegration(integration)}
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
        />
      )}
    </Stack>
  );
}
