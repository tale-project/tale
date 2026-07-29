'use client';

import { Badge } from '@tale/ui/badge';
import { KeyRound, Pencil, Power, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteCredential,
  useSetDefaultCredential,
  useUpdateCredential,
} from '../hooks/mutations';
import type { ProviderCatalog, MaskedCredential } from '../hooks/queries';
import { authMethodLabel, isKnownAuthMethod } from '../labels';
import { mapProviderError } from '../provider-errors';
import { CredentialEditDialog } from './credential-edit-dialog';
import { ReplaceSecretDialog } from './replace-secret-dialog';

interface CredentialRowProps {
  organizationId: string;
  credential: MaskedCredential;
  provider: ProviderCatalog;
}

/**
 * One credential of a provider: name + default/status markers on the first
 * line, the auth-method badge with the masked preview (api-key / broker) or
 * the env-var name (env) on the second, and the row actions menu (default,
 * enable/disable, secret replacement, edit, delete-with-confirm). The list
 * is a reactive Convex query, so successful writes re-render the row without
 * manual refresh.
 */
export function CredentialRow({
  organizationId,
  credential,
  provider,
}: CredentialRowProps) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const setDefault = useSetDefaultCredential();
  const update = useUpdateCredential();
  const remove = useDeleteCredential();

  const [editOpen, setEditOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const disabled = credential.status === 'disabled';
  const busy = setDefault.isPending || update.isPending || remove.isPending;

  const failToast = (err: unknown) =>
    toast({
      title: t('providers.credential.updateFailed', {
        error: mapProviderError(err),
      }),
      variant: 'destructive',
    });

  const handleMakeDefault = async () => {
    try {
      await setDefault.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
    } catch (err) {
      console.error('providers: set default credential failed', err);
      failToast(err);
    }
  };

  const handleToggleStatus = async () => {
    try {
      await update.mutateAsync({
        organizationId,
        credentialId: credential.id,
        status: disabled ? 'active' : 'disabled',
      });
    } catch (err) {
      console.error('providers: toggle credential status failed', err);
      failToast(err);
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
      toast({ title: t('providers.credential.deletedToast') });
      setDeleteOpen(false);
    } catch (err) {
      console.error('providers: delete credential failed', err);
      failToast(err);
    }
  };

  const replaceLabel =
    credential.authMethod === 'api-key'
      ? t('providers.replace.apiKeyTitle')
      : credential.authMethod === 'env'
        ? t('providers.replace.envTitle')
        : credential.authMethod === 'subscription-key'
          ? t('providers.replace.subscriptionKeyTitle')
          : t('providers.replace.brokerTitle');
  // Secret replacement exists only for the methods this page can author; a
  // method outside that set (a future provider vocabulary) keeps the rest
  // of the row's actions.
  const replaceable = isKnownAuthMethod(credential.authMethod);

  const actions: EntityRowAction[] = [
    {
      key: 'make-default',
      label: t('providers.credential.makeDefault'),
      icon: Star,
      onClick: () => void handleMakeDefault(),
      visible: !credential.isDefault,
      // The server refuses a disabled default (CREDENTIAL_DISABLED); keep the
      // entry visible but inert so the rule is discoverable.
      disabled: disabled || busy,
    },
    {
      key: 'toggle-status',
      label: disabled
        ? t('providers.credential.enable')
        : t('providers.credential.disable'),
      icon: Power,
      onClick: () => void handleToggleStatus(),
      disabled: busy,
    },
    {
      key: 'replace-secret',
      label: replaceLabel,
      icon: KeyRound,
      onClick: () => setReplaceOpen(true),
      visible: replaceable,
      disabled: busy,
    },
    {
      key: 'edit',
      label: t('providers.credential.edit'),
      icon: Pencil,
      onClick: () => setEditOpen(true),
      disabled: busy,
    },
    {
      key: 'delete',
      label: t('providers.credential.delete'),
      icon: Trash2,
      onClick: () => setDeleteOpen(true),
      destructive: true,
      disabled: busy,
    },
  ];

  const maskedValue =
    credential.authMethod === 'env'
      ? credential.envName
      : credential.maskedPreview;

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {credential.name}
          </span>
          {credential.isDefault && (
            <Badge variant="blue">{t('providers.credential.default')}</Badge>
          )}
          {disabled && (
            <Badge variant="slate">{t('providers.credential.disabled')}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {authMethodLabel(t, credential.authMethod)}
          </Badge>
          {maskedValue !== undefined && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {maskedValue}
            </span>
          )}
          {credential.endpointUrl !== undefined && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {credential.endpointUrl}
            </span>
          )}
          {credential.modelAllowlist !== undefined &&
            credential.modelAllowlist.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {t('providers.credential.allowlistCount', {
                  count: credential.modelAllowlist.length,
                })}
              </span>
            )}
        </div>
      </div>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('providers.credential.actionsLabel', {
          name: credential.name,
        })}
      />

      <CredentialEditDialog
        organizationId={organizationId}
        credential={credential}
        provider={provider}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ReplaceSecretDialog
        organizationId={organizationId}
        credential={credential}
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('providers.credential.deleteTitle')}
        description={t('providers.credential.deleteBody', {
          name: credential.name,
        })}
        warning={
          credential.isDefault
            ? t('providers.credential.deleteDefaultWarning')
            : undefined
        }
        isDeleting={remove.isPending}
        onDelete={() => void handleDelete()}
      />
    </li>
  );
}
