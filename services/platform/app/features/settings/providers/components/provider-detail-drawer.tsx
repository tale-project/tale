'use client';

import { Alert } from '@tale/ui/alert';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { AlertTriangle, X } from 'lucide-react';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useT } from '@/lib/i18n/client';
import type { modelTagLiterals } from '@/lib/shared/schemas/providers';
import { type ProviderJson } from '@/lib/shared/schemas/providers';

import { useHasProviderSecret, useReadProvider } from '../hooks/queries';
import { ProviderConfigProvider } from '../hooks/use-provider-config-context';
import { readConvexErrorData } from '../utils/error-dispatch';
import { ProviderDetailBody } from './provider-detail-drawer/provider-detail-body';

interface ProviderDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  providerName: string;
}

/**
 * Stand-in config used to mount the REAL `ProviderConfigProvider` +
 * `ProviderDetailBody` while the live config is still loading. Per the
 * skeleton cardinal rule we never render a separate skeleton tree: the real
 * sections render against this placeholder and their dynamic value leaves mask
 * themselves via `<SkeletonBox>`/`<SkeletonText>` inside `<Skeletonize loading>`.
 * The placeholder strings only set the masked leaves' natural size; they are
 * never visible (the pulse overlay covers them) and never submitted (every
 * editing control is disabled/non-interactive while masked).
 */
const PLACEHOLDER_PROVIDER_CONFIG: ProviderJson = {
  displayName: 'Provider name',
  description: 'Provider description',
  baseUrl: 'https://api.example.com',
  providerOptions: {},
  // A few rows so the masked models list reads like the real one. `tags`
  // carries 'chat' so each row renders (and masks) a capability badge.
  models: Array.from({ length: 4 }, (_, i) => ({
    id: `placeholder-model-${i}`,
    displayName: 'Model name',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 'chat' is a valid modelTagLiterals member; placeholder is never validated/persisted
    tags: ['chat'] as Array<(typeof modelTagLiterals)[number]>,
  })),
};

export function ProviderDetailDrawer({
  open,
  onOpenChange,
  organizationId,
  providerName,
}: ProviderDetailDrawerProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const enabled = open;
  const { data, isLoading } = useReadProvider(organizationId, providerName, {
    enabled,
  });
  const { data: maskedKey, error: secretError } = useHasProviderSecret(
    organizationId,
    providerName,
    { enabled },
  );

  // Narrow the discriminated read result so `config`/`hash`/`maskedModelKeys`
  // are reachable; `undefined` while loading or on the not-found branch.
  const okData = data?.ok ? data : undefined;

  const errorData = readConvexErrorData(secretError);
  const encryptedNoKey = errorData?.code === 'PROVIDER_SECRET_ENCRYPTED_NO_KEY';
  const encryptedNoKeyPath =
    encryptedNoKey && typeof errorData?.path === 'string' ? errorData.path : '';

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('providers.details')}
      size="md"
      resize={{ storageKey: 'provider-detail-drawer-width' }}
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('providers.details')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:px-6 sm:py-5">
        {encryptedNoKey && (
          <div className="pb-5">
            <Alert
              variant="destructive"
              icon={AlertTriangle}
              title={t('providers.encryptedNoKeyTitle')}
              description={t('providers.encryptedNoKeyDescription', {
                path: encryptedNoKeyPath,
              })}
            />
          </div>
        )}

        {!isLoading && !data?.ok ? (
          <Stack gap={4}>
            <Text variant="muted">
              {t('providers.providerNotFound', { name: providerName })}
            </Text>
          </Stack>
        ) : (
          // ONE tree, always. While loading we mount the real
          // ProviderConfigProvider + ProviderDetailBody against a placeholder
          // config and let <Skeletonize loading> mask each dynamic value in
          // place — no separate skeleton tree. `key` remounts the provider
          // when the real config arrives so its initial-state seeds correctly.
          <Skeletonize loading={isLoading} label={t('providers.details')}>
            <ProviderConfigProvider
              key={isLoading ? 'loading' : 'loaded'}
              organizationId={organizationId}
              providerName={providerName}
              initialConfig={okData?.config ?? PLACEHOLDER_PROVIDER_CONFIG}
              initialHash={okData?.hash}
            >
              <ProviderDetailBody
                organizationId={organizationId}
                providerName={providerName}
                maskedKey={maskedKey ?? null}
                maskedModelKeys={okData?.maskedModelKeys ?? {}}
                providerEnvStatus={okData?.envSecretStatus?.provider}
                isLoading={isLoading}
              />
            </ProviderConfigProvider>
          </Skeletonize>
        )}
      </div>
    </Sheet>
  );
}
