'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useProviderConfig } from '../../hooks/use-provider-config-context';
import { ProviderDefaultModelsPanel } from '../provider-default-models-panel';
import { InfoRow } from './info-row';

export function DefaultModelsSection({
  organizationId,
  providerName,
}: {
  organizationId: string;
  providerName: string;
}) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();
  const [panelOpen, setPanelOpen] = useState(false);

  const modelDisplayName = useCallback(
    (modelId: string | undefined) => {
      if (!modelId) return '—';
      return (
        config.models.find((m) => m.id === modelId)?.displayName ?? modelId
      );
    },
    [config.models],
  );

  return (
    <>
      <Stack gap={3}>
        <HStack justify="between" align="start" wrap className="gap-y-1">
          <Stack gap={1} className="min-w-0">
            <Text
              as="h3"
              className="text-foreground text-base leading-tight font-semibold"
            >
              {t('providers.defaultModels')}
            </Text>
            <Text className="text-muted-foreground text-sm">
              {t('providers.defaultModelsDescription')}
            </Text>
          </Stack>
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setPanelOpen(true)}
          >
            <Pencil className="mr-1 size-3.5" />
            {t('providers.editDefaults')}
          </Button>
        </HStack>
        <Card padding="none">
          <InfoRow label={t('providers.tagChat')}>
            <SkeletonBox>{modelDisplayName(config.defaults?.chat)}</SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagVision')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.vision)}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagEmbedding')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.embedding)}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagImageGeneration')}>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.['image-generation'])}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('providers.tagTranscription')} isLast>
            <SkeletonBox>
              {modelDisplayName(config.defaults?.transcription)}
            </SkeletonBox>
          </InfoRow>
        </Card>
      </Stack>

      <ProviderDefaultModelsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        organizationId={organizationId}
        providerName={providerName}
      />
    </>
  );
}
