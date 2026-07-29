'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { KeyRound, Pencil, Power, Star, Trash2 } from 'lucide-react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { CredentialEditDialog } from './credential-edit-dialog';
import { ReplaceSecretDialog } from './replace-secret-dialog';

const DIALOGS = ['edit', 'replace', 'delete'] as const;

/**
 * One stored credential of a vendor: its name plus default/state markers on the
 * first line, the auth method with its masked coordinates on the second, an
 * optional explanation line, and the row's action menu.
 *
 * Health states stay verbally and visually apart. A disabled credential is an
 * operator's own decision — a neutral marker, undone by enabling it again. A
 * grant the system could not refresh gets the attention colour, says what
 * happened, and offers the one action that fixes it. Both are surfaced, neither
 * is repaired automatically.
 *
 * The copy here is the shared `settings.credentials.*` namespace, not a
 * per-surface one: "Make default" and "Delete credential" mean the same thing
 * whether the secret belongs to a connector or an AI provider, and static keys
 * keep the i18n usage check able to see them.
 */
export function CredentialRow<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  credential,
  vendor,
  adapter,
}: {
  organizationId: string;
  credential: Cred;
  vendor: V;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const setDefault = adapter.mutations.useSetDefault();
  const update = adapter.mutations.useUpdate();
  const remove = adapter.mutations.useDelete();
  const dialogs = useEntityRowDialogs([...DIALOGS]);

  const disabled = credential.status === 'disabled';
  const busy = setDefault.isPending || update.isPending || remove.isPending;

  const failToast = (err: unknown) =>
    toast({
      title: t('credentials.updateFailed', { error: adapter.mapError(err) }),
      variant: 'destructive',
    });

  const handleMakeDefault = async () => {
    try {
      await setDefault.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
    } catch (err) {
      console.error(`${adapter.logTag}: set default credential failed`, err);
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
      console.error(`${adapter.logTag}: toggle credential status failed`, err);
      failToast(err);
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        organizationId,
        credentialId: credential.id,
      });
      toast({ title: t('credentials.deletedToast') });
      dialogs.setOpen.delete(false);
    } catch (err) {
      console.error(`${adapter.logTag}: delete credential failed`, err);
      failToast(err);
    }
  };

  const method = adapter.methodOf(credential);
  // One source of truth for "is this replaceable": the same `null` that makes
  // the dialog render nothing also hides the action, so they cannot disagree.
  const replaceLabel =
    method === null ? null : adapter.secret.replaceTitle(t, method);
  const replaceable =
    method !== null &&
    replaceLabel !== null &&
    adapter.secret.hasFields(method);

  const actions: EntityRowAction[] = [
    ...(adapter.extraActions?.({ t, credential, organizationId, busy }) ?? []),
    {
      key: 'make-default',
      label: t('credentials.makeDefault'),
      icon: Star,
      onClick: () => void handleMakeDefault(),
      visible: !credential.isDefault,
      // A disabled credential cannot serve requests, so it cannot be the
      // fallback either. Visible but inert, so the rule is discoverable
      // rather than mysterious.
      disabled: disabled || busy,
    },
    {
      key: 'toggle-status',
      label: disabled ? t('credentials.enable') : t('credentials.disable'),
      icon: Power,
      onClick: () => void handleToggleStatus(),
      disabled: busy,
    },
    {
      key: 'replace-secret',
      label: replaceLabel ?? '',
      icon: KeyRound,
      onClick: () => dialogs.setOpen.replace(true),
      visible: replaceable,
      disabled: busy,
    },
    {
      key: 'edit',
      label: t('credentials.edit'),
      icon: Pencil,
      onClick: () => dialogs.setOpen.edit(true),
      disabled: busy,
    },
    {
      key: 'delete',
      label: t('credentials.delete'),
      icon: Trash2,
      onClick: () => dialogs.setOpen.delete(true),
      destructive: true,
      disabled: busy,
    },
  ];

  const status = adapter.statusLabel(t, credential.status);
  const detail = adapter.detailLine?.(t, credential);

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {credential.name}
          </span>
          {credential.isDefault && (
            <Badge variant="blue">{t('credentials.default')}</Badge>
          )}
          {status !== null && (
            <Badge variant={adapter.statusTone(credential.status)}>
              {status}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {adapter.methodLabel(t, credential.authMethod)}
          </Badge>
          {adapter
            .facts(credential)
            .filter((fact): fact is string => fact !== undefined)
            .map((fact) => (
              <span
                key={fact}
                className="text-muted-foreground truncate font-mono text-xs"
              >
                {fact}
              </span>
            ))}
          {adapter.factNote?.(t, credential)}
        </div>
        {detail !== undefined && detail !== null && (
          <Text as="p" variant="muted" className="text-xs">
            {detail}
          </Text>
        )}
      </div>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('credentials.actionsLabel', { name: credential.name })}
      />

      <CredentialEditDialog
        organizationId={organizationId}
        credential={credential}
        vendor={vendor}
        adapter={adapter}
        open={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
      />
      {replaceable && (
        <ReplaceSecretDialog
          organizationId={organizationId}
          credential={credential}
          adapter={adapter}
          open={dialogs.isOpen.replace}
          onOpenChange={dialogs.setOpen.replace}
        />
      )}
      <DeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        title={t('credentials.deleteTitle')}
        description={t('credentials.deleteBody', { name: credential.name })}
        warning={
          credential.isDefault
            ? t('credentials.deleteDefaultWarning')
            : undefined
        }
        isDeleting={remove.isPending}
        onDelete={() => void handleDelete()}
      />
    </li>
  );
}
