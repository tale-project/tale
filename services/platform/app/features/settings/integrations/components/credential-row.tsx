'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { KeyRound, Pencil, Power, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type {
  IntegrationConnectorSummary,
  MaskedIntegrationCredential,
} from '../hooks/backend';
import {
  useDeleteCredential,
  useSetDefaultCredential,
  useUpdateCredential,
} from '../hooks/mutations';
import { mapIntegrationError } from '../integration-errors';
import { goToAuthorization } from '../integration-oauth';
import { authMethodLabel, statusLabel } from '../labels';
import { CredentialEditDialog } from './credential-edit-dialog';
import { ReplaceSecretDialog } from './replace-secret-dialog';

interface CredentialRowProps {
  organizationId: string;
  credential: MaskedIntegrationCredential;
  connector: IntegrationConnectorSummary;
}

/**
 * One credential of a connector: name plus its default/state markers on the
 * first line, the auth-method badge with the masked secret and the instance
 * endpoint on the second, and the row actions menu.
 *
 * The two unhealthy states stay visually and verbally apart. `disabled` is an
 * operator's decision — a neutral marker, undone by enabling the credential
 * again. `needs-reauth` is the system reporting a grant it could not refresh:
 * it gets the attention colour, says what happened, and offers Reconnect,
 * because re-running the consent flow is the only thing that fixes it.
 */
export function CredentialRow({
  organizationId,
  credential,
  connector,
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
  const needsReauth = credential.status === 'needs-reauth';
  const isOAuth = credential.authMethod === 'oauth2';
  const busy = setDefault.isPending || update.isPending || remove.isPending;

  const failToast = (err: unknown) =>
    toast({
      title: t('integrations.credential.updateFailed', {
        error: mapIntegrationError(err),
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
      console.error('integrations: set default credential failed', err);
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
      console.error('integrations: toggle credential status failed', err);
      failToast(err);
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
      toast({ title: t('integrations.credential.deletedToast') });
      setDeleteOpen(false);
    } catch (err) {
      console.error('integrations: delete credential failed', err);
      failToast(err);
    }
  };

  const replaceLabel =
    credential.authMethod === 'api-key'
      ? t('integrations.replace.apiKeyTitle')
      : credential.authMethod === 'bearer'
        ? t('integrations.replace.tokenTitle')
        : t('integrations.replace.basicTitle');

  const actions: EntityRowAction[] = [
    {
      key: 'reconnect',
      label: t('integrations.credential.reconnect'),
      icon: RefreshCw,
      // Re-consent is the same hand-off as a first connection; the callback
      // refreshes the grant this credential already holds.
      onClick: () =>
        goToAuthorization(organizationId, credential.connectorSlug),
      visible: isOAuth,
      disabled: busy,
    },
    {
      key: 'make-default',
      label: t('integrations.credential.makeDefault'),
      icon: Star,
      onClick: () => void handleMakeDefault(),
      visible: !credential.isDefault,
      // A disabled credential can't serve requests, so it can't be the
      // fallback either; keep the entry visible but inert so the rule is
      // discoverable rather than mysterious.
      disabled: disabled || busy,
    },
    {
      key: 'toggle-status',
      label: disabled
        ? t('integrations.credential.enable')
        : t('integrations.credential.disable'),
      icon: Power,
      onClick: () => void handleToggleStatus(),
      disabled: busy,
    },
    {
      key: 'replace-secret',
      label: replaceLabel,
      icon: KeyRound,
      onClick: () => setReplaceOpen(true),
      // An OAuth grant has no hand-entered secret to replace.
      visible: !isOAuth,
      disabled: busy,
    },
    {
      key: 'edit',
      label: t('integrations.credential.edit'),
      icon: Pencil,
      onClick: () => setEditOpen(true),
      disabled: busy,
    },
    {
      key: 'delete',
      label: t('integrations.credential.delete'),
      icon: Trash2,
      onClick: () => setDeleteOpen(true),
      destructive: true,
      disabled: busy,
    },
  ];

  const status = statusLabel(t, credential.status);

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {credential.name}
          </span>
          {credential.isDefault && (
            <Badge variant="blue">{t('integrations.credential.default')}</Badge>
          )}
          {status !== null && (
            <Badge variant={needsReauth ? 'orange' : 'slate'}>{status}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {authMethodLabel(t, credential.authMethod)}
          </Badge>
          {credential.maskedPreview !== undefined && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {credential.maskedPreview}
            </span>
          )}
          {credential.endpointUrl !== undefined && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {credential.endpointUrl}
            </span>
          )}
        </div>
        {needsReauth && (
          <Text as="p" variant="muted" className="text-xs">
            {credential.statusDetail !== undefined
              ? t('integrations.credential.needsReauthDetail', {
                  detail: credential.statusDetail,
                })
              : t('integrations.credential.needsReauthHint')}
          </Text>
        )}
      </div>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('integrations.credential.actionsLabel', {
          name: credential.name,
        })}
      />

      <CredentialEditDialog
        organizationId={organizationId}
        credential={credential}
        connector={connector}
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
        title={t('integrations.credential.deleteTitle')}
        description={t('integrations.credential.deleteBody', {
          name: credential.name,
        })}
        warning={
          credential.isDefault
            ? t('integrations.credential.deleteDefaultWarning')
            : undefined
        }
        isDeleting={remove.isPending}
        onDelete={() => void handleDelete()}
      />
    </li>
  );
}
