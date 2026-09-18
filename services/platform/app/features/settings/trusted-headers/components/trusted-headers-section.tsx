'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { HStack, Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { useMemo, useState } from 'react';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import {
  TRUSTED_HEADER_ASSERTABLE_ROLES,
  TRUSTED_HEADER_KEY_NAME_MAX,
  TRUSTED_HEADER_KEYS_PER_ORG_MAX,
  type TrustedHeaderAssertableRole,
  type TrustedHeaderKeyView,
  type TrustedHeaderNames,
} from '@/lib/shared/schemas/trusted_headers';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import {
  useCreateTrustedHeaderKey,
  useRevokeTrustedHeaderKey,
  useSetTrustedHeaderSettings,
  useTrustedHeaders,
} from '../hooks/use-trusted-headers';

/**
 * The trusted-headers card on Settings > Enterprise SSO: an application that
 * already signs its users in hands them into THIS organization through its
 * reverse proxy, presenting one of the organization's keys on the hand-off
 * door. The card owns the switch, the role ceiling, the door's address and
 * header names the proxy must speak, and the keys — minted here, shown once,
 * revoked by a stamp. Admin-gated by the page (`orgSettings`); the controls
 * follow the ability too, so a read-only visitor sees the state without
 * being able to move it.
 */
export function TrustedHeadersSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: view } = useTrustedHeaders(organizationId);
  const setSettings = useSetTrustedHeaderSettings();
  const createKey = useCreateTrustedHeaderKey();
  const revokeKey = useRevokeTrustedHeaderKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<TrustedHeaderKeyView | null>(null);

  const loaded = view !== undefined;
  const enabled = view?.enabled ?? false;
  const maxRole: TrustedHeaderAssertableRole =
    view?.maxAssertedRole ?? 'member';
  const keys = view?.keys ?? [];
  const atLimit = keys.length >= TRUSTED_HEADER_KEYS_PER_ORG_MAX;
  const endpoint = `${getEnv('SITE_URL')}${getEnv('BASE_PATH')}/api/trusted-headers/authenticate`;
  const controlsDisabled = !canEdit || !loaded || setSettings.isPending;

  const roleOptions = useMemo(
    () =>
      TRUSTED_HEADER_ASSERTABLE_ROLES.map((role) => ({
        value: role,
        label: t(`roles.${role}`),
      })),
    [t],
  );

  const apply = (next: {
    enabled: boolean;
    maxAssertedRole: TrustedHeaderAssertableRole;
  }) => {
    setSettings.mutate({ organizationId, ...next });
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setKeyName('');
    setCreatedKey(null);
  };

  const submitCreate = async () => {
    try {
      const created = await createKey.mutateAsync({
        organizationId,
        name: keyName.trim(),
      });
      setCreatedKey(created.key);
      toast({
        title: t('enterpriseSso.trustedHeaders.keyCreated'),
        variant: 'success',
      });
    } catch (error) {
      // The mutation hook already toasts the refusal; the dialog stays open
      // with the name so the admin can retry.
      console.error('trusted-headers: key creation failed', error);
    }
  };

  const confirmRevoke = async () => {
    if (revoking === null) return;
    try {
      await revokeKey.mutateAsync({ organizationId, keyId: revoking.id });
      toast({
        title: t('enterpriseSso.trustedHeaders.revoked'),
        variant: 'success',
      });
      setRevoking(null);
    } catch (error) {
      console.error('trusted-headers: key revocation failed', error);
    }
  };

  return (
    <SettingsSection
      title={
        <HStack gap={2} align="center" wrap>
          {t('enterpriseSso.trustedHeaders.section')}
          {enabled ? (
            <Badge variant="green" dot>
              {t('enterpriseSso.trustedHeaders.enabled')}
            </Badge>
          ) : (
            <Badge variant="slate" dot>
              {t('enterpriseSso.trustedHeaders.disabled')}
            </Badge>
          )}
        </HStack>
      }
      description={t('enterpriseSso.trustedHeaders.help')}
    >
      <Stack gap={4}>
        <SettingsToggleRow
          label={t('enterpriseSso.trustedHeaders.toggleLabel')}
          description={t('enterpriseSso.trustedHeaders.toggleHelp')}
          checked={enabled}
          onCheckedChange={(checked) =>
            apply({ enabled: checked, maxAssertedRole: maxRole })
          }
          disabled={controlsDisabled}
          ariaBusy={setSettings.isPending}
        />
        <SettingsFieldList>
          <SettingsFieldRow
            label={t('enterpriseSso.trustedHeaders.maxRoleLabel')}
            description={t('enterpriseSso.trustedHeaders.maxRoleHelp')}
          >
            <Select
              id="trusted-headers-max-role"
              aria-label={t('enterpriseSso.trustedHeaders.maxRoleLabel')}
              value={maxRole}
              onValueChange={(value) => {
                const next = narrowStringUnion<TrustedHeaderAssertableRole>(
                  value,
                  TRUSTED_HEADER_ASSERTABLE_ROLES,
                );
                if (next) apply({ enabled, maxAssertedRole: next });
              }}
              options={roleOptions}
              disabled={controlsDisabled}
            />
          </SettingsFieldRow>
          <SettingsFieldRow
            label={t('enterpriseSso.trustedHeaders.endpointLabel')}
            description={t('enterpriseSso.trustedHeaders.endpointHelp')}
          >
            <CopyableField
              value={endpoint}
              mono
              copyAriaLabel={t('enterpriseSso.copy')}
            />
          </SettingsFieldRow>
          <SettingsFieldRow
            label={t('enterpriseSso.trustedHeaders.headersLabel')}
            description={t('enterpriseSso.trustedHeaders.headersHelp')}
          >
            <HeaderNames names={view?.headers} />
          </SettingsFieldRow>
        </SettingsFieldList>

        <Stack gap={2}>
          {/* The action sits with the list it grows, not in the card header
              three settings above it. */}
          <HStack gap={4} align="start" justify="between" wrap>
            <Stack gap={1}>
              <Text as="h3" variant="label">
                {t('enterpriseSso.trustedHeaders.keysTitle')}
              </Text>
              <Text variant="muted">
                {t('enterpriseSso.trustedHeaders.keysHelp')}
              </Text>
            </Stack>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit || !loaded || atLimit}
              onClick={() => setCreateOpen(true)}
            >
              {t('enterpriseSso.trustedHeaders.createKey')}
            </Button>
          </HStack>
          {atLimit && (
            <Text variant="muted" role="status">
              {t('enterpriseSso.trustedHeaders.limitReached', {
                max: TRUSTED_HEADER_KEYS_PER_ORG_MAX,
              })}
            </Text>
          )}
          {loaded && keys.length === 0 ? (
            <Text variant="muted">
              {t('enterpriseSso.trustedHeaders.noKeys')}
            </Text>
          ) : (
            <ul className="divide-border divide-y">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                >
                  <Stack gap={0}>
                    <Text as="span" variant="body" className="font-medium">
                      {key.name}
                    </Text>
                    <Text as="span" variant="caption" className="font-mono">
                      {key.tokenPrefix}
                    </Text>
                  </Stack>
                  <HStack gap={4} align="center" wrap>
                    <Text as="span" variant="caption">
                      {t('enterpriseSso.trustedHeaders.createdAt')}{' '}
                      <TableDateCell date={key.createdAt} preset="short" />
                    </Text>
                    <Text as="span" variant="caption">
                      {key.lastUsedAt === null ? (
                        t('enterpriseSso.trustedHeaders.neverUsed')
                      ) : (
                        <>
                          {t('enterpriseSso.trustedHeaders.lastUsed')}{' '}
                          <TableDateCell
                            date={key.lastUsedAt}
                            preset="relative"
                          />
                        </>
                      )}
                    </Text>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() => setRevoking(key)}
                      aria-label={`${t('enterpriseSso.trustedHeaders.revoke')}: ${key.name}`}
                    >
                      {t('enterpriseSso.trustedHeaders.revoke')}
                    </Button>
                  </HStack>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Stack>

      <FormDialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open) setCreateOpen(true);
          else closeCreate();
        }}
        title={
          createdKey === null
            ? t('enterpriseSso.trustedHeaders.createKey')
            : t('enterpriseSso.trustedHeaders.keyCreated')
        }
        submitText={t('enterpriseSso.trustedHeaders.createKey')}
        isSubmitting={createKey.isPending}
        isValid={keyName.trim().length > 0}
        onSubmit={(event) => {
          event.preventDefault();
          void submitCreate();
        }}
        {...(createdKey !== null
          ? {
              customFooter: (
                <Button type="button" onClick={closeCreate}>
                  {tCommon('actions.done')}
                </Button>
              ),
            }
          : {})}
      >
        {createdKey === null ? (
          <Input
            id="trusted-header-key-name"
            label={t('enterpriseSso.trustedHeaders.keyName')}
            placeholder={t('enterpriseSso.trustedHeaders.keyNamePlaceholder')}
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            maxLength={TRUSTED_HEADER_KEY_NAME_MAX}
            required
            className="w-full"
          />
        ) : (
          // Each field is labelled with the header the proxy sends the key
          // in, so the person leaves with "header: value", not a bare secret
          // to look up a header name for.
          <Stack gap={4}>
            <CopyableField
              label={view?.headers.key ?? 'Remote-Internal-Secret'}
              value={createdKey}
              mono
              copyAriaLabel={t('enterpriseSso.copy')}
              description={t('enterpriseSso.trustedHeaders.keyCreatedHelp')}
            />
            <CopyableField
              label="Authorization"
              value={`Bearer ${createdKey}`}
              mono
              copyAriaLabel={t('enterpriseSso.copy')}
              description={t('enterpriseSso.trustedHeaders.keyCreatedSendAs')}
            />
          </Stack>
        )}
      </FormDialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t('enterpriseSso.trustedHeaders.revokeTitle')}
        description={t('enterpriseSso.trustedHeaders.revokeDescription', {
          name: revoking?.name ?? '',
        })}
        confirmText={t('enterpriseSso.trustedHeaders.revoke')}
        isLoading={revokeKey.isPending}
        onConfirm={() => void confirmRevoke()}
      />
    </SettingsSection>
  );
}

/** The header names the door reads — what the proxy has to send. */
function HeaderNames({ names }: { names: TrustedHeaderNames | undefined }) {
  const { t } = useT('settings');
  const rows: { label: string; value: string | undefined }[] = [
    { label: t('enterpriseSso.trustedHeaders.headerKey'), value: names?.key },
    {
      label: t('enterpriseSso.trustedHeaders.headerEmail'),
      value: names?.email,
    },
    { label: t('enterpriseSso.trustedHeaders.headerName'), value: names?.name },
    { label: t('enterpriseSso.trustedHeaders.headerRole'), value: names?.role },
    {
      label: t('enterpriseSso.trustedHeaders.headerTeams'),
      value: names?.teams,
    },
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt>
            <Text as="span" variant="caption">
              {row.label}
            </Text>
          </dt>
          <dd>
            <Text as="span" variant="body-sm" className="font-mono">
              {row.value ?? '—'}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}
