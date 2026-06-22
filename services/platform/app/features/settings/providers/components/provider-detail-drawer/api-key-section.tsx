'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { AlertTriangle, Pencil, Zap } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  type EnvSecretStatus,
  SECRETS_ENV_PREFIX,
  SECRETS_ENV_REGEX,
} from '@/lib/shared/schemas/providers';
import { cn } from '@/lib/utils/cn';

import { useSaveProviderSecret } from '../../hooks/mutations';
import { useProviderConfig } from '../../hooks/use-provider-config-context';
import { computeEffectiveKeyState } from '../../utils/effective-key-source';
import {
  dispatchForbiddenDeveloperSettings,
  dispatchOrgAccessError,
  dispatchVersionConflict,
  readConvexErrorData,
} from '../../utils/error-dispatch';
import { TestConnectionSheet } from '../test-connection-sheet';

export function ApiKeySection({
  organizationId,
  providerName,
  maskedKey,
  providerEnvStatus,
  isLoading,
}: {
  organizationId: string;
  providerName: string;
  maskedKey: string | null;
  /** Provider-level `secretsEnv` resolution status (issue #1711). */
  providerEnvStatus?: EnvSecretStatus;
  isLoading: boolean;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tCommon } = useT('common');
  // Env-var key source (issue #1711) lives in the public provider config, so it
  // is read/written via the same config context as the General/Options editors.
  const { config, saveConfig } = useProviderConfig();
  // While loading we don't yet know whether a key exists; render the
  // "configured" chrome with a placeholder value so the masked row has its
  // natural size (the pulse covers the placeholder text).
  const hasSecret = isLoading || maskedKey != null;
  const saveSecret = useSaveProviderSecret();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  // Env-var override name. Seeded from config on open via `openDialog`.
  const [envName, setEnvName] = useState(SECRETS_ENV_PREFIX);
  // Don't flag the seeded/incomplete prefix as an error until the user edits it.
  const [envTouched, setEnvTouched] = useState(false);
  const envError = useMemo(() => {
    if (!envTouched) return false;
    const value = envName.trim();
    if (!value) return false;
    return value.length > 40 || !SECRETS_ENV_REGEX.test(value);
  }, [envName, envTouched]);
  const [overwritePrompt, setOverwritePrompt] = useState<{
    kind: 'encrypted_no_key' | 'undecryptable_existing';
    path: string;
    reason?: string;
  } | null>(null);

  const performSave = useCallback(
    async (force: boolean) => {
      if (!apiKey.trim() || !organizationId) return;
      setSaving(true);
      try {
        await saveSecret.mutateAsync({
          organizationId,
          providerName,
          apiKey: apiKey.trim(),
          force: force || undefined,
        });
        // Leave the dialog open so the operator can also adjust the env
        // override in one session; dismissal is via the footer "Close" button.
        setApiKey('');
        setOverwritePrompt(null);
        toast({
          title: t('providers.apiKeyUpdated'),
          variant: 'success',
        });
      } catch (err) {
        const data = readConvexErrorData(err);
        if (
          data?.code === 'PROVIDER_SECRET_REFUSED_OVERWRITE' &&
          (data.kind === 'encrypted_no_key' ||
            data.kind === 'undecryptable_existing')
        ) {
          setOverwritePrompt({
            kind: data.kind,
            path: typeof data.path === 'string' ? data.path : '',
            reason: typeof data.reason === 'string' ? data.reason : undefined,
          });
        } else {
          setOverwritePrompt(null);
          if (
            !dispatchOrgAccessError(err, tAccessDenied) &&
            !dispatchForbiddenDeveloperSettings(err, t)
          ) {
            toast({
              title: t('providers.secretSaveFailed'),
              variant: 'destructive',
            });
          }
        }
      } finally {
        setSaving(false);
      }
    },
    [apiKey, organizationId, providerName, saveSecret, t, tAccessDenied],
  );

  // Persist the env-var NAME into the public provider config (not the secrets
  // file). The file key, if any, stays as the resolver's fallback — the env
  // source wins until cleared.
  const performSaveEnv = useCallback(async () => {
    const name = envName.trim();
    if (!name || envError) return;
    setSaving(true);
    try {
      await saveConfig({ secretsEnv: name });
      toast({ title: t('providers.saved'), variant: 'success' });
    } catch (err) {
      if (
        !dispatchOrgAccessError(err, tAccessDenied) &&
        !dispatchForbiddenDeveloperSettings(err, t) &&
        !dispatchVersionConflict(err, t)
      ) {
        toast({
          title: t('providers.secretSaveFailed'),
          variant: 'destructive',
        });
      }
    } finally {
      setSaving(false);
    }
  }, [envName, envError, saveConfig, t, tAccessDenied]);

  const clearEnv = useCallback(async () => {
    setSaving(true);
    try {
      await saveConfig({ secretsEnv: undefined });
      toast({ title: t('providers.envVarCleared'), variant: 'success' });
    } catch (err) {
      if (
        !dispatchOrgAccessError(err, tAccessDenied) &&
        !dispatchForbiddenDeveloperSettings(err, t) &&
        !dispatchVersionConflict(err, t)
      ) {
        toast({
          title: t('providers.secretSaveFailed'),
          variant: 'destructive',
        });
      }
    } finally {
      setSaving(false);
    }
  }, [saveConfig, t, tAccessDenied]);

  const handleConfirmOverwrite = useCallback(() => {
    void performSave(true);
  }, [performSave]);

  // Seed the env-var field from the saved config each time the dialog opens,
  // then keep the user's in-dialog edits even if a sibling refetch lands.
  const openDialog = useCallback(() => {
    setEnvName(config.secretsEnv ?? SECRETS_ENV_PREFIX);
    setEnvTouched(false);
    setApiKey('');
    setDialogOpen(true);
  }, [config.secretsEnv]);

  // Effective key source (mirrors the backend resolver: env-resolves wins,
  // file is the fallback). Drives the dialog banner so precedence is legible.
  const effectiveKeyState = computeEffectiveKeyState({
    providerEnvStatus,
    hasSecret,
  });
  const envVarName = providerEnvStatus?.name ?? '';
  const banner: {
    variant: 'default' | 'warning' | 'destructive';
    icon?: typeof AlertTriangle;
    title?: string;
    description: string;
  } = (() => {
    switch (effectiveKeyState) {
      case 'env-resolving':
        return {
          variant: 'default',
          title: t('providers.effectiveSourceEnvTitle'),
          description: hasSecret
            ? `${t('providers.effectiveSourceEnv', { name: envVarName })} ${t('providers.storedKeyFallbackNote')}`
            : t('providers.effectiveSourceEnv', { name: envVarName }),
        };
      case 'env-unresolved-fallback':
        return {
          variant: 'warning',
          icon: AlertTriangle,
          title: t('providers.effectiveSourceEnvUnresolvedTitle'),
          description: t('providers.effectiveSourceFallbackToFile', {
            name: envVarName,
          }),
        };
      case 'env-unresolved-no-file':
        return {
          variant: 'warning',
          icon: AlertTriangle,
          title: t('providers.effectiveSourceEnvUnresolvedTitle'),
          description: t('providers.effectiveSourceEnvUnresolvedNoFile', {
            name: envVarName,
          }),
        };
      case 'env-not-prefixed':
        return {
          variant: 'destructive',
          icon: AlertTriangle,
          title: t('providers.effectiveSourceEnvUnresolvedTitle'),
          description: t('providers.effectiveSourceEnvNotPrefixed', {
            name: envVarName,
            prefix: SECRETS_ENV_PREFIX,
          }),
        };
      case 'stored-only':
        return {
          variant: 'default',
          description: t('providers.effectiveSourceStored'),
        };
      case 'none':
        return {
          variant: 'default',
          description: t('providers.effectiveSourceNone'),
        };
      default: {
        const _exhaustive: never = effectiveKeyState;
        throw new Error('Unhandled key source state: ' + String(_exhaustive));
      }
    }
  })();

  return (
    <>
      <Stack gap={3}>
        <HStack justify="between" align="center" wrap className="gap-y-1">
          <Text
            as="h3"
            className="text-foreground min-w-0 text-base leading-tight font-semibold"
          >
            {t('providers.apiKey')}
          </Text>
          <HStack
            gap={1}
            align="center"
            wrap
            className="ml-auto justify-end gap-y-1"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTestDialogOpen(true)}
            >
              <Zap className="mr-1 size-3.5" />
              {t('providers.testConnection')}
            </Button>
            <Button variant="ghost" size="sm" onClick={openDialog}>
              <Pencil className="mr-1 size-3.5" />
              {hasSecret || config.secretsEnv
                ? t('providers.editKey')
                : t('providers.addKey')}
            </Button>
          </HStack>
        </HStack>
        <Card padding="none">
          {/* Env-var key source (issue #1711). When a `secretsEnv` is
              configured it is the preferred source; show whether it currently
              resolves. A stored key is shown below whenever one exists — even
              when the env var resolves — so a shadowed fallback is never
              invisible (it carries a "fallback" badge in that case). */}
          {providerEnvStatus?.name && (
            <HStack
              gap={3}
              align="center"
              className={cn('flex-wrap px-4 py-2.5', hasSecret && 'border-b')}
            >
              <Badge
                variant={providerEnvStatus.resolved ? 'green' : 'outline'}
                dot
              >
                {providerEnvStatus.resolved
                  ? t('providers.envVarSet')
                  : providerEnvStatus.allowed
                    ? t('providers.envVarNotSet')
                    : t('providers.envVarNotPrefixed')}
              </Badge>
              <Text className="text-muted-foreground text-sm">
                {t('providers.keyFromEnvVar', {
                  name: providerEnvStatus.name,
                })}
              </Text>
            </HStack>
          )}
          {hasSecret ? (
            <HStack gap={4} align="center" className="flex-wrap px-4 py-2.5">
              <SkeletonBox>
                <Badge variant="green" dot>
                  {t('providers.apiKeyConfigured')}
                </Badge>
              </SkeletonBox>
              <Text className="text-muted-foreground font-mono text-sm">
                <SkeletonBox>{maskedKey ?? 'sk-••••••••••••'}</SkeletonBox>
              </Text>
              {providerEnvStatus?.name && providerEnvStatus.resolved && (
                <Badge variant="outline">
                  {t('providers.storedKeyFallbackBadge')}
                </Badge>
              )}
            </HStack>
          ) : (
            !providerEnvStatus?.name && (
              <HStack gap={3} align="center" className="px-4 py-2.5">
                <Badge variant="outline">
                  {t('providers.apiKeyNotConfigured')}
                </Badge>
              </HStack>
            )
          )}
        </Card>
      </Stack>

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setApiKey('');
        }}
        title={t('providers.apiKey')}
        isSubmitting={saving}
        customFooter={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDialogOpen(false)}
            disabled={saving}
          >
            {tCommon('actions.close')}
          </Button>
        }
      >
        {/* Effective-source banner: what the provider uses *right now*, and why.
            Env-resolves wins over the stored key; otherwise the stored key is
            the fallback (see `computeEffectiveKeyState`). */}
        <Alert
          variant={banner.variant}
          icon={banner.icon}
          title={banner.title}
          description={banner.description}
        />

        {/* Stored API key — the SOPS file secret. Always editable; it stays the
            resolver's fallback even when an env override is configured. */}
        <Stack gap={2}>
          <Text as="h3" className="text-foreground text-sm font-semibold">
            {t('providers.storedKeyLabel')}
          </Text>
          <HStack gap={3} align="center" className="flex-wrap">
            <Badge variant={hasSecret ? 'green' : 'outline'} dot>
              {hasSecret
                ? t('providers.apiKeyConfigured')
                : t('providers.apiKeyNotConfigured')}
            </Badge>
            {hasSecret && maskedKey && (
              <Text className="text-muted-foreground font-mono text-sm">
                {maskedKey}
              </Text>
            )}
          </HStack>
          <Input
            type="password"
            label={
              hasSecret
                ? t('providers.replaceStoredKeyLabel')
                : t('providers.apiKey')
            }
            placeholder={t('providers.apiKeyEnter')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={() => performSave(false)}
            disabled={saving || apiKey.trim().length === 0}
          >
            {t('providers.saveKey')}
          </Button>
        </Stack>

        {/* Environment-variable override (issue #1711). When set + resolved it
            shadows the stored key above; otherwise it falls back to it. */}
        <Stack gap={2}>
          <Text as="h3" className="text-foreground text-sm font-semibold">
            {t('providers.secretsEnv')}
          </Text>
          <Input
            placeholder={t('providers.secretsEnvPlaceholder')}
            description={t('providers.secretsEnvHelp')}
            value={envName}
            onChange={(e) => {
              setEnvTouched(true);
              setEnvName(e.target.value);
            }}
            errorMessage={
              envError ? t('providers.secretsEnvPatternError') : undefined
            }
          />
          <HStack gap={2} align="center" wrap>
            <Button
              type="button"
              size="sm"
              onClick={performSaveEnv}
              disabled={
                saving ||
                !SECRETS_ENV_REGEX.test(envName.trim()) ||
                envName.trim() === config.secretsEnv
              }
            >
              {t('providers.setEnvVar')}
            </Button>
            {config.secretsEnv && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearEnv}
                disabled={saving}
              >
                {t('providers.clearEnvVar')}
              </Button>
            )}
          </HStack>
        </Stack>
      </FormDialog>

      <TestConnectionSheet
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        organizationId={organizationId}
        providerName={providerName}
      />

      <ConfirmDialog
        open={overwritePrompt != null}
        onOpenChange={(open) => {
          if (!open) setOverwritePrompt(null);
        }}
        title={t('providers.overwriteUnreadableTitle')}
        description={
          overwritePrompt
            ? overwritePrompt.kind === 'encrypted_no_key'
              ? t('providers.overwriteEncryptedNoKeyDescription', {
                  path: overwritePrompt.path,
                })
              : t('providers.overwriteUndecryptableDescription', {
                  path: overwritePrompt.path,
                  reason: overwritePrompt.reason ?? '',
                })
            : ''
        }
        confirmText={t('providers.overwriteAnywayConfirm')}
        variant="destructive"
        isLoading={saving}
        onConfirm={handleConfirmOverwrite}
      />
    </>
  );
}
