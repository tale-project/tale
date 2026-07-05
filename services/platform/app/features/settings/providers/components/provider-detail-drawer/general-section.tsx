'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useProviderConfig } from '../../hooks/use-provider-config-context';
import { ProviderEditPanel } from '../provider-edit-panel';
import { InfoRow } from './info-row';

export function GeneralSection({
  providerName,
  organizationId,
  initialEditOpen = false,
}: {
  providerName: string;
  organizationId: string;
  initialEditOpen?: boolean;
}) {
  const { t } = useT('settings');
  const { config } = useProviderConfig();
  const [panelOpen, setPanelOpen] = useState(initialEditOpen);

  return (
    <Stack gap={3}>
      <HStack justify="between" align="center" wrap className="gap-y-1">
        <Text
          as="h3"
          className="text-foreground min-w-0 text-base leading-tight font-semibold"
        >
          {t('providers.general')}
        </Text>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => setPanelOpen(true)}
        >
          <Pencil className="mr-1 size-3.5" />
          {t('providers.editGeneral')}
        </Button>
      </HStack>
      <Card padding="none">
        <InfoRow label={t('providers.displayName')}>
          <SkeletonBox>{config.displayName}</SkeletonBox>
        </InfoRow>
        <InfoRow label={t('providers.description_field')} muted>
          <SkeletonBox>{config.description || '—'}</SkeletonBox>
        </InfoRow>
        <InfoRow label={t('providers.baseUrl')} muted isLast>
          <SkeletonBox>{config.baseUrl}</SkeletonBox>
        </InfoRow>
      </Card>

      <ProviderEditPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        providerName={providerName}
        organizationId={organizationId}
      />
    </Stack>
  );
}
