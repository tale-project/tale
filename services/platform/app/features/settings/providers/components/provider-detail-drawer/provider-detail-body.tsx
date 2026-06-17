'use client';

import { Stack } from '@tale/ui/layout';

import { type EnvSecretStatus } from '@/lib/shared/schemas/providers';

import { ApiKeySection } from './api-key-section';
import { DefaultModelsSection } from './default-models-section';
import { GeneralSection } from './general-section';
import { ModelsSection } from './models-section';
import { ProviderOptionsSection } from './provider-options-section';

export function ProviderDetailBody({
  organizationId,
  providerName,
  maskedKey,
  maskedModelKeys,
  providerEnvStatus,
  isLoading,
}: {
  organizationId: string;
  providerName: string;
  maskedKey: string | null;
  maskedModelKeys: Record<string, string>;
  providerEnvStatus?: EnvSecretStatus;
  isLoading: boolean;
}) {
  return (
    <Stack gap={6}>
      <GeneralSection
        providerName={providerName}
        organizationId={organizationId}
      />
      <ApiKeySection
        organizationId={organizationId}
        providerName={providerName}
        maskedKey={maskedKey}
        providerEnvStatus={providerEnvStatus}
        isLoading={isLoading}
      />
      <DefaultModelsSection
        organizationId={organizationId}
        providerName={providerName}
      />
      <ProviderOptionsSection />
      <ModelsSection
        organizationId={organizationId}
        providerName={providerName}
        maskedModelKeys={maskedModelKeys}
        isLoading={isLoading}
      />
    </Stack>
  );
}
