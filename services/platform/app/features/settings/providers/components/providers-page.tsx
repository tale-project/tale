'use client';

import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card } from '@/app/components/ui/layout/card';
import { Grid, HStack, Stack } from '@/app/components/ui/layout/layout';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { useHasProviderSecret, useListProviders } from '../hooks/queries';
import { ProviderAddDialog } from './provider-add-dialog';
import { ProviderEditPanel } from './provider-edit-panel';

interface ProvidersPageProps {
  organizationId: string;
}

interface ProviderListItem {
  name: string;
  displayName?: string;
  description?: string;
  baseUrl?: string;
  modelCount?: number;
  models?: Array<{ id: string; displayName?: string; tags?: string[] }>;
}

function ProviderCardSkeleton() {
  return (
    <Card className="flex flex-col justify-between" contentClassName="p-5">
      <Stack gap={3}>
        <HStack justify="between" align="start">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </HStack>
        <Stack gap={1}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </Stack>
        <Skeleton className="h-4 w-20" />
      </Stack>
    </Card>
  );
}

function ProvidersSkeleton() {
  return (
    <Stack gap={0}>
      <HStack justify="between" align="start" className="pb-3">
        <Stack gap={1}>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-64" />
        </Stack>
        <Skeleton className="h-9 w-40" />
      </HStack>
      <Grid cols={1} md={2} lg={3}>
        {Array.from({ length: 3 }).map((_, i) => (
          <ProviderCardSkeleton key={i} />
        ))}
      </Grid>
    </Stack>
  );
}

export function ProvidersPage({ organizationId }: ProvidersPageProps) {
  const { t } = useT('settings');
  const { providers, isLoading } = useListProviders('default');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- providers shape is guaranteed by file_actions.listProviders contract
  const providerList = (providers ?? []) as ProviderListItem[];
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  return (
    <Stack gap={6}>
      {isLoading ? (
        <ProvidersSkeleton />
      ) : (
        <Stack gap={4}>
          <SectionHeader
            title={t('providers.title')}
            description={t('providers.description')}
            action={
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-1.5 size-4" />
                {t('providers.addProvider')}
              </Button>
            }
          />

          {providerList.length === 0 ? (
            <Card contentClassName="p-8 text-center">
              <Stack gap={2}>
                <Text variant="muted">{t('providers.noProviders')}</Text>
                <Text variant="muted" className="text-sm">
                  {t('providers.noProvidersDescription')}
                </Text>
              </Stack>
            </Card>
          ) : (
            <Grid cols={1} md={2} lg={3}>
              {providerList.map((provider) => (
                <button
                  key={provider.name}
                  type="button"
                  className="text-left"
                  onClick={() => setSelectedProvider(provider.name)}
                >
                  <Card
                    className="hover:border-primary/50 h-full cursor-pointer transition-colors"
                    contentClassName="p-5"
                  >
                    <Stack gap={3}>
                      <HStack justify="between" align="start">
                        <Text className="font-semibold">
                          {provider.displayName ?? provider.name}
                        </Text>
                        <Badge variant="outline">
                          {t('providers.modelCount', {
                            count: provider.modelCount ?? 0,
                          })}
                        </Badge>
                      </HStack>
                      {provider.description && (
                        <Text variant="muted" className="line-clamp-2 text-sm">
                          {provider.description}
                        </Text>
                      )}
                      {provider.baseUrl && (
                        <Text variant="muted" className="truncate text-xs">
                          {provider.baseUrl}
                        </Text>
                      )}
                      <HStack gap={1}>
                        <KeyRound className="text-muted-foreground size-3.5" />
                        <ProviderSecretStatus providerName={provider.name} />
                      </HStack>
                    </Stack>
                  </Card>
                </button>
              ))}
            </Grid>
          )}
        </Stack>
      )}

      {selectedProvider && (
        <ProviderEditPanel
          open
          onOpenChange={(open) => {
            if (!open) setSelectedProvider(null);
          }}
          providerName={selectedProvider}
          organizationId={organizationId}
        />
      )}

      <ProviderAddDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        organizationId={organizationId}
      />
    </Stack>
  );
}

function ProviderSecretStatus({ providerName }: { providerName: string }) {
  const { t } = useT('settings');
  const { data: hasSecret, isLoading } = useHasProviderSecret(
    'default',
    providerName,
  );

  if (isLoading) {
    return <Skeleton className="h-3.5 w-20" />;
  }

  return (
    <Text variant="muted" className="text-xs">
      {hasSecret
        ? t('providers.apiKeyConfigured')
        : t('providers.apiKeyNotConfigured')}
    </Text>
  );
}
